import { serve } from "bun";
import { log } from "console";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import crypto from "crypto";

// Constants - Magic Numbers
const MAX_FILE_SIZE_MB = 50; // Maximum file size in MB
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_LOG_BACKUPS = 5;
const FTP_POOL_SIZE = 5;
const FTP_CONNECTION_TIMEOUT = 30000; // 30 seconds
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_SERVER_ERROR = 500;
const CLIENT_ID_HASH_LENGTH = 12;

// Configuration interface
interface Config {
    SAVE_PATH: string;
    PRINT_PATH: string;
    PORT: number;
    API_KEY?: string;
    MAX_FILE_SIZE_MB?: number;
    FTP_HOST?: string;
    FTP_PORT?: number;
    FTP_USERNAME?: string;
    FTP_PASSWORD?: string;
    FTP_REMOTE_PATH?: string;
    FTP_SECURE?: boolean;
    FTP_DIRECTORY?: string;
}

// Default configuration values
const DEFAULT_CONFIG: Config = {
    SAVE_PATH: path.resolve('./SAVE_IMAGES'),
    PRINT_PATH: path.resolve('./PRINT_IMAGES'),
    PORT: 5555,
    API_KEY: "tyI45KBNFS8hrGOdzjvwrG2c7J2odGVs",
    MAX_FILE_SIZE_MB: MAX_FILE_SIZE_MB,
    FTP_HOST: undefined,
    FTP_PORT: 21,
    FTP_USERNAME: undefined,
    FTP_PASSWORD: undefined,
    FTP_REMOTE_PATH: "/",
    FTP_SECURE: false,
    FTP_DIRECTORY: undefined
};

// Constants
const VERSION = "Dev";

const CONFIG_PATH = path.resolve('./config.txt');
const ERROR_LOG_PATH = path.resolve('./error.log');
const AP_KEY = DEFAULT_CONFIG.API_KEY;

createDefaultConfig();
const configs = parseConfigFile();
const SAVE_PATH = ensureSavePath(configs.SAVE_PATH || DEFAULT_CONFIG.SAVE_PATH);
const PRINT_PATH = ensurePrintPath(configs.PRINT_PATH || DEFAULT_CONFIG.PRINT_PATH);
const port = configs.PORT || DEFAULT_CONFIG.PORT;

// Initialize error log file
async function initializeErrorLog(): Promise<void> {
    try {
        await fsPromises.access(ERROR_LOG_PATH);
    } catch {
        await fsPromises.writeFile(ERROR_LOG_PATH, '');
    }
}

// Rotate log file if it exceeds max size
async function rotateLogFile(): Promise<void> {
    try {
        const stats = await fsPromises.stat(ERROR_LOG_PATH);
        if (stats.size >= MAX_LOG_SIZE_BYTES) {
            // Rotate existing backups
            for (let i = MAX_LOG_BACKUPS - 1; i > 0; i--) {
                const oldPath = `${ERROR_LOG_PATH}.${i}`;
                const newPath = `${ERROR_LOG_PATH}.${i + 1}`;
                try {
                    await fsPromises.rename(oldPath, newPath);
                } catch { /* Ignore if file doesn't exist */ }
            }
            // Move current log to .1
            await fsPromises.rename(ERROR_LOG_PATH, `${ERROR_LOG_PATH}.1`);
            await fsPromises.writeFile(ERROR_LOG_PATH, '');
            console.log('---> Log file rotated');
        }
    } catch (error) {
        console.error('Failed to rotate log:', error);
    }
}

// Log errors to a file with rotation
async function logErrorToFile(error: Error | string): Promise<void> {
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ${error instanceof Error ? error.stack : error}\n\n`;
    
    await rotateLogFile();
    await fsPromises.appendFile(ERROR_LOG_PATH, errorMessage, 'utf8');
    console.error(errorMessage);
}

// Response header function
function getResponseHeaders(): HeadersInit {
    return {
        "Content-Type": "application/json",
    };
}

// Consistent error response helper
function createErrorResponse(message: string, status: number = HTTP_STATUS_BAD_REQUEST): Response {
    return new Response(
        JSON.stringify({ success: false, message }),
        { status, headers: getResponseHeaders() }
    );
}

// Consistent success response helper
function createSuccessResponse(data: any, status: number = HTTP_STATUS_OK): Response {
    return new Response(
        JSON.stringify({ success: true, ...data }),
        { status, headers: getResponseHeaders() }
    );
}

// Function to get client identifier from IP and User-Agent
function getClientIdentifier(req: Request): string {
    // Get IP from headers
    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const cfConnectingIp = req.headers.get('cf-connecting-ip');
    const ip = cfConnectingIp || realIp || forwardedFor?.split(',')[0].trim() || 'unknown';
    
    // Get User-Agent
    const userAgent = req.headers.get('user-agent') || 'unknown';
    
    // Create hash from IP + User-Agent for privacy and shorter string
    const hash = crypto
        .createHash('sha256')
        .update(`${ip}-${userAgent}`)
        .digest('hex')
        .substring(0, CLIENT_ID_HASH_LENGTH);
    
    return hash;
}

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error: Error) => {
    logErrorToFile(error);
    process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
    logErrorToFile(reason as string);
    process.exit(1);
});

// Middleware to check the API key
function checkApiKey(req: Request): Response | null {
    const apiKey = req.headers.get('api-key');
    if (!apiKey) {
        return createErrorResponse("Require api-key", HTTP_STATUS_UNAUTHORIZED);
    }
    if (apiKey !== AP_KEY) {
        return createErrorResponse("Unauthorized", HTTP_STATUS_UNAUTHORIZED);
    }
    return null;
}

// Create a default config file if it doesn't exist
function createDefaultConfig(): void {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.log("---> Create a default config file");
        const defaultConfigString = [
            `SAVE_PATH="${DEFAULT_CONFIG.SAVE_PATH}"`,
            `PRINT_PATH="${DEFAULT_CONFIG.PRINT_PATH}"`,
            `PORT=${DEFAULT_CONFIG.PORT}`,
            `API_KEY="${DEFAULT_CONFIG.API_KEY}"`,
            `# FTP Configuration (uncomment to enable)`,
            `# FTP_HOST="your.ftp.server.com"`,
            `# FTP_PORT=${DEFAULT_CONFIG.FTP_PORT}`,
            `# FTP_USERNAME="your_username"`,
            `# FTP_PASSWORD="your_password"`,
            `# FTP_REMOTE_PATH="${DEFAULT_CONFIG.FTP_REMOTE_PATH}"`,
            `# FTP_SECURE=${DEFAULT_CONFIG.FTP_SECURE}`,
            ``
        ].join('\n');
        fs.writeFileSync(CONFIG_PATH, defaultConfigString);
    } else {
        console.log("---> Config file : ", CONFIG_PATH);
    }
}

// Parse config file into a typed configuration object
function parseConfigFile(): Config {
    return validateAndFixConfig();
}

// Ensure the save path exists
function ensureSavePath(savePath: string): string {
    if (!fs.existsSync(savePath)) {
        console.log("---> 'SAVE_PATH' Directory not exist");
        fs.mkdirSync(savePath, { recursive: true });
        console.log(`---> Create a default save images directory at ${savePath}`);
    }
    return savePath;
}

// Async version of ensureSavePath
async function ensureSavePathAsync(savePath: string): Promise<string> {
    try {
        await fsPromises.access(savePath);
    } catch {
        console.log("---> 'SAVE_PATH' Directory not exist");
        await fsPromises.mkdir(savePath, { recursive: true });
        console.log(`---> Create a default save images directory at ${savePath}`);
    }
    return savePath;
}

//ensure the print path exists
function ensurePrintPath(printPath: string): string {
    if (!fs.existsSync(printPath)) {
        console.log("---> 'PRINT_PATH' Directory not exist");
        fs.mkdirSync(printPath, { recursive: true });
        console.log(`---> Create a default print images directory at ${printPath}`);
    }
    return printPath;
}

// Async version of ensurePrintPath
async function ensurePrintPathAsync(printPath: string): Promise<string> {
    try {
        await fsPromises.access(printPath);
    } catch {
        console.log("---> 'PRINT_PATH' Directory not exist");
        await fsPromises.mkdir(printPath, { recursive: true });
        console.log(`---> Create a default print images directory at ${printPath}`);
    }
    return printPath;
}



// Function to get current configuration
function getCurrentConfig(): Config {
    return parseConfigFile();
}

// Function to reset config to default values
function resetConfigToDefault(): void {
    console.log("---> Resetting config to default values");
    fs.unlinkSync(CONFIG_PATH);
    createDefaultConfig();
}

// Function to update specific config value
function updateConfigValue(key: keyof Config, value: any): boolean {
    try {
        const currentConfig = getCurrentConfig();
        (currentConfig as any)[key] = value;

        const configLines = [
            `SAVE_PATH="${currentConfig.SAVE_PATH}"`,
            `PORT=${currentConfig.PORT}`,
            `API_KEY="${currentConfig.API_KEY}"`,
        ];

        // Add optional FTP settings if they exist
        if (currentConfig.FTP_HOST) {
            configLines.push(`FTP_HOST="${currentConfig.FTP_HOST}"`);
            configLines.push(`FTP_PORT=${currentConfig.FTP_PORT}`);
            if (currentConfig.FTP_USERNAME) configLines.push(`FTP_USERNAME="${currentConfig.FTP_USERNAME}"`);
            if (currentConfig.FTP_PASSWORD) configLines.push(`FTP_PASSWORD="${currentConfig.FTP_PASSWORD}"`);
            configLines.push(`FTP_REMOTE_PATH="${currentConfig.FTP_REMOTE_PATH}"`);
            configLines.push(`FTP_SECURE=${currentConfig.FTP_SECURE}`);
            if (currentConfig.FTP_DIRECTORY) configLines.push(`FTP_DIRECTORY=${currentConfig.FTP_DIRECTORY}`);
        }

        fs.writeFileSync(CONFIG_PATH, configLines.join('\n') + '\n');
        console.log(`---> Updated ${key} to ${value}`);
        return true;
    } catch (error: any) {
        console.error(`---> Failed to update config: ${error.message}`);
        return false;
    }
}

// Function to validate config and fix missing values
function validateAndFixConfig(): Config {
    let needsRewrite = false;
    const configData: Partial<Config> = {};

    // Read existing config file
    if (fs.existsSync(CONFIG_PATH)) {
        const lines = fs.readFileSync(CONFIG_PATH, "utf-8").split("\n");

        lines.forEach(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('#')) return;

            const [key, value] = trimmedLine.split("=");
            if (!key || !value) return;

            const cleanKey = key.trim() as keyof Config;
            const cleanValue = value.replace(/"/g, "").trim();

            // Type conversion
            switch (cleanKey) {
                case 'PORT':
                case 'FTP_PORT':
                case 'MAX_FILE_SIZE_MB':
                    configData[cleanKey] = Number(cleanValue);
                    break;
                case 'FTP_SECURE':
                    configData[cleanKey] = cleanValue.toLowerCase() === 'true';
                    break;
                default:
                    (configData as any)[cleanKey] = cleanValue || undefined;
                    break;
            }
        });
    } else {
        needsRewrite = true;
    }

    // Check for missing values and set defaults
    const finalConfig: Config = {
        SAVE_PATH: configData.SAVE_PATH || DEFAULT_CONFIG.SAVE_PATH,
        PRINT_PATH: configData.PRINT_PATH || DEFAULT_CONFIG.PRINT_PATH,
        PORT: configData.PORT || DEFAULT_CONFIG.PORT,
        API_KEY: configData.API_KEY || DEFAULT_CONFIG.API_KEY,
        MAX_FILE_SIZE_MB: configData.MAX_FILE_SIZE_MB || DEFAULT_CONFIG.MAX_FILE_SIZE_MB,
        FTP_HOST: configData.FTP_HOST || DEFAULT_CONFIG.FTP_HOST,
        FTP_PORT: configData.FTP_PORT || DEFAULT_CONFIG.FTP_PORT,
        FTP_USERNAME: configData.FTP_USERNAME || DEFAULT_CONFIG.FTP_USERNAME,
        FTP_PASSWORD: configData.FTP_PASSWORD || DEFAULT_CONFIG.FTP_PASSWORD,
        FTP_REMOTE_PATH: configData.FTP_REMOTE_PATH || DEFAULT_CONFIG.FTP_REMOTE_PATH,
        FTP_SECURE: configData.FTP_SECURE !== undefined ? configData.FTP_SECURE : DEFAULT_CONFIG.FTP_SECURE,
        FTP_DIRECTORY: configData.FTP_DIRECTORY || DEFAULT_CONFIG.FTP_DIRECTORY,
    };

    // Check if any default values were used (meaning something was missing)
    const configKeys = Object.keys(DEFAULT_CONFIG) as (keyof Config)[];
    for (const key of configKeys) {
        if (configData[key] === undefined && DEFAULT_CONFIG[key] !== undefined) {
            needsRewrite = true;
            console.log(`---> Missing config value for ${key}, using default: ${DEFAULT_CONFIG[key]}`);
        }
    }

    // Rewrite config file if needed
    if (needsRewrite) {
        console.log("---> Rewriting config file with complete values...");
        writeCompleteConfigFile(finalConfig);
    }

    return finalConfig;
}

// Function to write complete config file
function writeCompleteConfigFile(config: Config): void {
    const configLines = [
        `# Image Receiver Server Configuration`,
        `# Generated on ${new Date().toISOString()}`,
        ``,
        `# Basic Configuration`,
        `SAVE_PATH="${config.SAVE_PATH}"`,
        `PRINT_PATH="${config.PRINT_PATH}"`,
        `PORT=${config.PORT}`,
        `API_KEY="${config.API_KEY}"`,
        `MAX_FILE_SIZE_MB=${config.MAX_FILE_SIZE_MB}`,
        ``,
        `# FTP Configuration (uncomment and fill to enable FTP upload)`,
    ];

    if (config.FTP_HOST) {
        configLines.push(`FTP_HOST="${config.FTP_HOST}"`);
        configLines.push(`FTP_PORT=${config.FTP_PORT}`);
        if (config.FTP_USERNAME) configLines.push(`FTP_USERNAME="${config.FTP_USERNAME}"`);
        if (config.FTP_PASSWORD) configLines.push(`FTP_PASSWORD="${config.FTP_PASSWORD}"`);
        configLines.push(`FTP_REMOTE_PATH="${config.FTP_REMOTE_PATH}"`);
        configLines.push(`FTP_SECURE=${config.FTP_SECURE}`);
        if (config.FTP_DIRECTORY) configLines.push(`FTP_DIRECTORY=${config.FTP_DIRECTORY}`);
    } else {
        configLines.push(`# FTP_HOST="your.ftp.server.com"`);
        configLines.push(`# FTP_PORT=${DEFAULT_CONFIG.FTP_PORT}`);
        configLines.push(`# FTP_USERNAME="your_username"`);
        configLines.push(`# FTP_PASSWORD="your_password"`);
        configLines.push(`# FTP_REMOTE_PATH="${DEFAULT_CONFIG.FTP_REMOTE_PATH}"`);
        configLines.push(`# FTP_SECURE=${DEFAULT_CONFIG.FTP_SECURE}`);
        configLines.push(`# FTP_DIRECTORY="subfolder"`);
    }

    configLines.push('');

    fs.writeFileSync(CONFIG_PATH, configLines.join('\n'));
    console.log("---> Config file has been updated with complete values");
}

// Upload image in base64 format
async function uploadImage(req: Request, savePath: string, printPath: string): Promise<Response> {
    try {
        console.log("--- Upload Image ---");
        const encoded = await req.text();
        const payload = decodeURIComponent(encoded);

        let jsonObj: { base64: string; prefix_name?: string, folder?: string, ftp?: boolean, print?: boolean };

        jsonObj = JSON.parse(payload);
        if (!jsonObj.base64) {
            return createErrorResponse("Missing 'base64' field", HTTP_STATUS_BAD_REQUEST);
        }

        const matches = jsonObj.base64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return createErrorResponse("Invalid base64 format", HTTP_STATUS_BAD_REQUEST);
        }

        // Get client identifier
        const clientId = getClientIdentifier(req);
        
        // Determine the target path based on print flag
        let targetPath = savePath;
        if (jsonObj.print) {
            // If print is true, use printPath and ignore folder
            targetPath = printPath;
        } else if (jsonObj.folder) {
            // If print is false and folder is specified, use folder with savePath
            // Append client identifier to folder name
            const folderWithClient = `${jsonObj.folder}_${clientId}`;
            targetPath = path.join(savePath, folderWithClient);
            try {
                await fsPromises.access(targetPath);
            } catch {
                await fsPromises.mkdir(targetPath, { recursive: true });
            }
        }


        const [, type, data] = matches;
        const buffer = Buffer.from(data, "base64");
        
        // Validate file size
        const sizeValidation = validateFileSize(buffer.length);
        if (!sizeValidation.valid) {
            return createErrorResponse(sizeValidation.message!, HTTP_STATUS_BAD_REQUEST);
        }
        
        const prefixName = jsonObj.prefix_name || "image";
        //today format: 22_Dec_2025-22_00_00
        const date = new Date();
        const dateString = `${date.getDate()}_${date.toLocaleString('default', { month: 'short' })}_${date.getFullYear()}-${date.getHours()}_${date.getMinutes()}_${date.getSeconds()}`;
        const filename = `${prefixName}-${dateString}.${type}`;
        const filePath = path.join(targetPath, filename);

        await fsPromises.writeFile(filePath, new Uint8Array(buffer));
        if (jsonObj.print) {
            console.log("---> Save image to PRINT_PATH: ", filePath);
        } else {
            console.log("---> Save image to SAVE_PATH: ", filePath);
        }

        // Check if FTP upload is enabled
        if (jsonObj.ftp) {
            const ftpResult = await uploadToFtp(buffer, filename);
            if (ftpResult.success) {
                return createSuccessResponse({
                    message: "Image uploaded successfully to both local and FTP",
                    public_url: ftpResult.url
                });
            } else {
                // Local upload succeeded but FTP failed
                return createSuccessResponse({
                    message: `Image uploaded locally but FTP upload failed: ${ftpResult.message}`,
                    local_path: filePath
                });
            }
        }

        return createSuccessResponse({
            message: "Image uploaded successfully",
            local_path: filePath
        });
    } catch (e: any) {
        await logErrorToFile(e);
        return createErrorResponse(e.message, HTTP_STATUS_BAD_REQUEST);
    }
}

// FTP Connection Pool
class FTPConnectionPool {
    private pool: any[] = [];
    private activeConnections: number = 0;
    private ftp = require('ftp');

    async getConnection(): Promise<any> {
        // Create new connection if under pool size
        if (this.activeConnections < FTP_POOL_SIZE) {
            const client = new this.ftp();
            this.activeConnections++;
            return client;
        }

        // Wait for a connection slot to become available
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                if (this.activeConnections < FTP_POOL_SIZE) {
                    clearInterval(interval);
                    const client = new this.ftp();
                    this.activeConnections++;
                    resolve(client);
                }
            }, 100);
        });
    }

    releaseConnection(client: any): void {
        this.activeConnections--;
        // Don't add back to pool since we're closing connections after each use
        try {
            client.end();
        } catch { /* Ignore errors on connection close */ }
    }

    async closeAll(): Promise<void> {
        // No connections to close since we close them immediately after each use
        this.pool = [];
        this.activeConnections = 0;
    }
}

const ftpPool = new FTPConnectionPool();

// Shared FTP upload function with connection pooling
async function uploadToFtp(buffer: Buffer, filename: string): Promise<{ success: boolean; message: string; url?: string }> {
    const client = await ftpPool.getConnection();

    return new Promise((resolve) => {
        let timeoutHandle: NodeJS.Timeout;
        
        try {
            if (!configs.FTP_HOST || !configs.FTP_PORT || !configs.FTP_USERNAME || !configs.FTP_PASSWORD) {
                ftpPool.releaseConnection(client);
                resolve({
                    success: false,
                    message: "Missing FTP configuration in config file"
                });
                return;
            }

            const remotePath = configs.FTP_REMOTE_PATH || "/";
            let remoteFilePath: string;
            let publicUrl: string;

            if (configs.FTP_DIRECTORY) {
                const remoteDirectory = remotePath.endsWith('/') ? remotePath + configs.FTP_DIRECTORY : remotePath + '/' + configs.FTP_DIRECTORY;
                remoteFilePath = remoteDirectory + '/' + filename;
                publicUrl = `https://${configs.FTP_HOST}/${configs.FTP_DIRECTORY}/${filename}`;
            } else {
                remoteFilePath = remotePath.endsWith('/') ? remotePath + filename : remotePath + '/' + filename;
                publicUrl = `https://${configs.FTP_HOST}/${filename}`;
            }

            // Set connection timeout
            timeoutHandle = setTimeout(() => {
                client.destroy(); // Forcefully close the connection
                ftpPool.releaseConnection(client);
                resolve({
                    success: false,
                    message: "FTP connection timeout"
                });
            }, FTP_CONNECTION_TIMEOUT);

            client.on('ready', () => {
                client.put(buffer, remoteFilePath, (err: any) => {
                    clearTimeout(timeoutHandle);
                    if (err) {
                        logErrorToFile(err);
                        ftpPool.releaseConnection(client);
                        resolve({
                            success: false,
                            message: `FTP upload failed: ${err.message}`
                        });
                    } else {
                        console.log("---> Upload image to FTP: ", publicUrl);
                        ftpPool.releaseConnection(client);
                        resolve({
                            success: true,
                            message: "Image uploaded to FTP successfully",
                            url: publicUrl
                        });
                    }
                });
            });

            client.on('error', (err: any) => {
                clearTimeout(timeoutHandle);
                logErrorToFile(err);
                ftpPool.releaseConnection(client);
                resolve({
                    success: false,
                    message: `FTP connection failed: ${err.message}`
                });
            });

            client.connect({
                host: configs.FTP_HOST,
                port: configs.FTP_PORT,
                user: configs.FTP_USERNAME,
                password: configs.FTP_PASSWORD,
                secure: configs.FTP_SECURE || false,
                connTimeout: FTP_CONNECTION_TIMEOUT
            });

        } catch (error: any) {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            logErrorToFile(error);
            ftpPool.releaseConnection(client);
            resolve({
                success: false,
                message: `FTP upload failed: ${error.message}`
            });
        }
    });
}


// File size validation helper
function validateFileSize(sizeInBytes: number): { valid: boolean; message?: string } {
    const maxSize = (configs.MAX_FILE_SIZE_MB || MAX_FILE_SIZE_MB) * 1024 * 1024;
    if (sizeInBytes > maxSize) {
        return {
            valid: false,
            message: `File size exceeds maximum allowed size of ${configs.MAX_FILE_SIZE_MB || MAX_FILE_SIZE_MB}MB`
        };
    }
    return { valid: true };
}

// Example payload for FTP upload
// {
//     "prefix_name": "test",
//     "base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEU"    
// }
//

async function uploadImageToFtp(req: Request): Promise<Response> {
    try {
        console.log("---> Upload Image to FTP <---");

        const encoded = await req.text();
        const payload = decodeURIComponent(encoded);

        let jsonObj: {
            base64: string;
            prefix_name?: string;
        };

        try {
            jsonObj = JSON.parse(payload);

            if (!jsonObj.base64) {
                return createErrorResponse("Missing 'base64' field", HTTP_STATUS_BAD_REQUEST);
            }

            const matches = jsonObj.base64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return createErrorResponse("Invalid base64 format", HTTP_STATUS_BAD_REQUEST);
            }

            const [, type, data] = matches;
            const buffer = Buffer.from(data, "base64");
            
            // Validate file size
            const sizeValidation = validateFileSize(buffer.length);
            if (!sizeValidation.valid) {
                return createErrorResponse(sizeValidation.message!, HTTP_STATUS_BAD_REQUEST);
            }
            const prefixName = jsonObj.prefix_name || "image";
            const date = new Date();
            const dateString = `${date.getDate()}_${date.toLocaleString('default', { month: 'short' })}_${date.getFullYear()}-${date.getHours()}_${date.getMinutes()}_${date.getSeconds()}`;

            const filename = `${prefixName}-${dateString}.${type}`;

            const ftpResult = await uploadToFtp(buffer, filename);

            if (ftpResult.success) {
                return createSuccessResponse({
                    message: ftpResult.message,
                    public_url: ftpResult.url
                });
            } else {
                return createErrorResponse(ftpResult.message, HTTP_STATUS_SERVER_ERROR);
            }

        } catch (parseError: any) {
            return createErrorResponse(`Parse error: ${parseError.message}`, HTTP_STATUS_BAD_REQUEST);
        }

    } catch (error: any) {
        await logErrorToFile(error);
        return createErrorResponse(`FTP upload failed: ${error.message}`, HTTP_STATUS_SERVER_ERROR);
    }
}

// Upload file endpoint (handles multipart/form-data)
async function uploadFile(req: Request): Promise<Response> {
    try {
        console.log("--- Upload File ---");

        const formData = await req.formData();
        const file = formData.get('file') as File;
        const folder = formData.get('folder') as string;
        const print = formData.get('print') === 'true';
        const ftp = formData.get('ftp') === 'true';
        const prefix_name = formData.get('prefix_name') as string;

        if (!file) {
            return createErrorResponse("No file provided", HTTP_STATUS_BAD_REQUEST);
        }
        
        // Validate file size
        const sizeValidation = validateFileSize(file.size);
        if (!sizeValidation.valid) {
            return createErrorResponse(sizeValidation.message!, HTTP_STATUS_BAD_REQUEST);
        }

        // Accept all file types - no restriction
        console.log(`---> Uploading file: ${file.name} (${file.type || 'unknown type'}, ${file.size} bytes)`);

        // Get client identifier
        const clientId = getClientIdentifier(req);
        
        // Determine target path
        let targetPath = SAVE_PATH;
        if (print) {
            targetPath = PRINT_PATH;
        } else if (folder) {
            // Append client identifier to folder name
            const folderWithClient = `${folder}_${clientId}`;
            targetPath = path.join(SAVE_PATH, folderWithClient);
            try {
                await fsPromises.access(targetPath);
            } catch {
                await fsPromises.mkdir(targetPath, { recursive: true });
            }
        }

        // Generate filename
        const date = new Date();
        const dateString = `${date.getDate()}_${date.toLocaleString('default', { month: 'short' })}_${date.getFullYear()}-${date.getHours()}_${date.getMinutes()}_${date.getSeconds()}`;
        const fileExtension = path.extname(file.name) || '';
        const baseName = prefix_name || path.basename(file.name, fileExtension) || 'file';
        const filename = `${baseName}_${clientId}_${dateString}${fileExtension}`;

        // Save file
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = path.join(targetPath, filename);

        await fsPromises.writeFile(filePath, new Uint8Array(buffer));

        // Verify file was saved
        try {
            await fsPromises.access(filePath);
        } catch {
            return createErrorResponse("File save failed", HTTP_STATUS_SERVER_ERROR);
        }

        if (print) {
            console.log("---> Save file to PRINT_PATH: ", filePath);
        } else {
            console.log("---> Save file to SAVE_PATH: ", filePath);
        }

        // Handle FTP upload if requested
        if (ftp) {
            const ftpResult = await uploadToFtp(buffer, filename);
            if (ftpResult.success) {
                return createSuccessResponse({
                    message: "File uploaded successfully to both local and FTP",
                    local_path: filePath,
                    public_url: ftpResult.url,
                    file_info: {
                        name: file.name,
                        size: file.size,
                        type: file.type
                    }
                });
            } else {
                return createSuccessResponse({
                    message: `File uploaded locally but FTP upload failed: ${ftpResult.message}`,
                    local_path: filePath,
                    file_info: {
                        name: file.name,
                        size: file.size,
                        type: file.type
                    }
                });
            }
        }

        return createSuccessResponse({
            message: "File uploaded successfully",
            local_path: filePath,
            file_info: {
                name: file.name,
                size: file.size,
                type: file.type
            }
        });

    } catch (e: any) {
        await logErrorToFile(e);
        return createErrorResponse(e.message, HTTP_STATUS_BAD_REQUEST);
    }
}

// Handle incoming requests
async function handleRequest(req: Request): Promise<Response> {
    // get type of request

    const apiKeyError = checkApiKey(req);
    if (apiKeyError) return apiKeyError;



    //log method and url
    // console.log("---> Method: ", req.method);

    const parsedUrl = new URL(req.url, `http://${req.headers.get('host')}`);
    const pathname = parsedUrl.pathname;

    // console.log("---> pathname: ", pathname);

    if (req.method === "GET" && pathname === "/check") {
        return createSuccessResponse({ message: "Server is running" });
    } else if (req.method === "GET" && pathname === "/save_path") {
        return createSuccessResponse({ save_path: SAVE_PATH });

    } else if (req.method === "POST" && pathname === "/upload_image") {
        return uploadImage(req, SAVE_PATH, PRINT_PATH);
    }
    else if (req.method === "POST" && pathname === "/upload_file") {
        return uploadFile(req);
    }
    else if (req.method === "POST" && pathname === "/upload_image_ftp") {
        return uploadImageToFtp(req);
    } else if (req.method === "GET" && pathname === "/config") {
        // Get current configuration
        const currentConfig = getCurrentConfig();
        return createSuccessResponse({ config: currentConfig });
    } else if (req.method === "POST" && pathname === "/config/reset") {
        // Reset config to default values
        try {
            resetConfigToDefault();
            return createSuccessResponse({ message: "Config has been reset to default values" });
        } catch (error: any) {
            return createErrorResponse(`Failed to reset config: ${error.message}`, HTTP_STATUS_SERVER_ERROR);
        }
    } else if (req.method === "POST" && pathname === "/config/update") {
        // Update specific config value
        try {
            const body = await req.json();
            const { key, value } = body;

            if (!key || value === undefined) {
                return createErrorResponse("Missing 'key' or 'value' in request body", HTTP_STATUS_BAD_REQUEST);
            }

            const success = updateConfigValue(key, value);
            if (success) {
                return createSuccessResponse({ message: `Updated ${key} to ${value}` });
            } else {
                return createErrorResponse(`Failed to update ${key}`, HTTP_STATUS_SERVER_ERROR);
            }
        } catch (error: any) {
            return createErrorResponse(`Failed to update config: ${error.message}`, HTTP_STATUS_SERVER_ERROR);
        }
    }
    else {
        return createErrorResponse("CANNOT GET: The requested resource was not found", HTTP_STATUS_NOT_FOUND);
    }
}

// Initialization
(async () => {
    try {
        // Initialize error log
        await initializeErrorLog();
        
        console.log("---> Save Image Folder : ", SAVE_PATH);
        console.log("---> Print Image Folder : ", PRINT_PATH);
        console.log(`---> Max file size: ${configs.MAX_FILE_SIZE_MB || MAX_FILE_SIZE_MB}MB`);

        const server = serve({
            fetch: handleRequest,
            port: port,
        });

        //get ip address
        const ip = require('ip').address();

        console.log('---> Server version ' + VERSION + ' is running on ' + ip + ':' + port);
        
        // Cleanup on exit
        process.on('SIGINT', async () => {
            console.log('\n---> Shutting down server...');
            await ftpPool.closeAll();
            process.exit(0);
        });
        
    } catch (e: any) {
        await logErrorToFile(e);
        process.exit(1);
    }
})();
