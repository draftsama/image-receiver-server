import { serve } from "bun";
import { log } from "console";
import fs from "fs";
import path from "path";

// Configuration interface
interface Config {
    SAVE_PATH: string;
    PRINT_PATH: string;
    PORT: number;
    API_KEY?: string;
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
    FTP_HOST: undefined,
    FTP_PORT: 21,
    FTP_USERNAME: undefined,
    FTP_PASSWORD: undefined,
    FTP_REMOTE_PATH: "/",
    FTP_SECURE: false,
    FTP_DIRECTORY: undefined
};

// Constants
const CONFIG_PATH = path.resolve('./config.txt');
const ERROR_LOG_PATH = path.resolve('./error.log');
const AP_KEY = DEFAULT_CONFIG.API_KEY;

createDefaultConfig();
const configs = parseConfigFile();
const SAVE_PATH = ensureSavePath(configs.SAVE_PATH || DEFAULT_CONFIG.SAVE_PATH);
const PRINT_PATH = ensurePrintPath(configs.PRINT_PATH || DEFAULT_CONFIG.PRINT_PATH);
const port = configs.PORT || DEFAULT_CONFIG.PORT;

// Check if error log file exists and clear it if not
if (!fs.existsSync(ERROR_LOG_PATH)) {
    fs.writeFileSync(ERROR_LOG_PATH, '');
}

// Log errors to a file
function logErrorToFile(error: Error | string): void {
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ${error instanceof Error ? error.stack : error}\n\n`;
    fs.appendFileSync(ERROR_LOG_PATH, errorMessage, 'utf8');
    console.error(errorMessage); // Log the error message to the console as well
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
function checkApiKey(req: Request): any | null {
    const apiKey = req.headers.get('api-key');
    if (!apiKey) {
        return new Response(JSON.stringify({ message: "Require api-key" }), { status: 401, headers: responseHeader });
    }
    if (apiKey !== AP_KEY) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401, headers: responseHeader });
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

//ensure the print path exists
function ensurePrintPath(printPath: string): string {
    if (!fs.existsSync(printPath)) {
        console.log("---> 'PRINT_PATH' Directory not exist");
        fs.mkdirSync(printPath, { recursive: true });
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

        let jsonObj: { base64: string; prefix_name?: string, folder?: string, ftp?: boolean , print?: boolean};



        jsonObj = JSON.parse(payload);
        if (!jsonObj.base64) {

            return new Response(JSON.stringify({ success: false, message: "Missing 'base64' field" }), { status: 400, headers: responseHeader });
        }

        const matches = jsonObj.base64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return new Response(JSON.stringify({ success: false, message: "Invalid base64 format" }), { status: 400, headers: responseHeader });
        }

        // Determine the target path based on print flag
        let targetPath = savePath;
        if (jsonObj.print) {
            // If print is true, use printPath and ignore folder
            targetPath = printPath;
        } else if (jsonObj.folder) {
            // If print is false and folder is specified, use folder with savePath
            targetPath = path.join(savePath, jsonObj.folder);
            if (!fs.existsSync(targetPath)) {
                fs.mkdirSync(targetPath, { recursive: true });
            }
        }


        const [, type, data] = matches;
        const prefixName = jsonObj.prefix_name || "image";
        //today format: 22_Dec_2025-22_00_00
        const date = new Date();
        const dateString = `${date.getDate()}_${date.toLocaleString('default', { month: 'short' })}_${date.getFullYear()}-${date.getHours()}_${date.getMinutes()}_${date.getSeconds()}`;
        const filename = `${prefixName}-${dateString}.${type}`;
        const buffer = Buffer.from(data, "base64");
        const filePath = path.join(targetPath, filename);

        fs.writeFileSync(filePath, new Uint8Array(buffer));
        if(jsonObj.print){
            console.log("---> Save image to PRINT_PATH: ", filePath);
        } else {
            console.log("---> Save image to SAVE_PATH: ", filePath);
        }

        // Check if FTP upload is enabled
        if (jsonObj.ftp) {
            const ftpResult = await uploadToFtp(buffer, filename);
            if (ftpResult.success) {
                return new Response(
                    JSON.stringify({
                        success: true,
                        message: "Image uploaded successfully to both local and FTP",
                        public_url: ftpResult.url
                    }),
                    { status: 200, headers: responseHeader }
                );
            } else {
                // Local upload succeeded but FTP failed
                return new Response(
                    JSON.stringify({
                        success: true,
                        message: `Image uploaded locally but FTP upload failed: ${ftpResult.message}`,
                        local_path: filePath
                    }),
                    { status: 200, headers: responseHeader }
                );
            }
        }

        return new Response(
            JSON.stringify({ success: true, message: "Image uploaded successfully", local_path: filePath }),
            { status: 200, headers: responseHeader }
        );
    } catch (e: any) {
        logErrorToFile(e);
        return new Response(JSON.stringify({ success: false, message: e.message }), { status: 400, headers: responseHeader });
    }
}

// Shared FTP upload function
async function uploadToFtp(buffer: Buffer, filename: string): Promise<{ success: boolean; message: string; url?: string }> {
    const ftp = require('ftp');
    const client = new ftp();

    return new Promise((resolve) => {
        try {
            if (!configs.FTP_HOST || !configs.FTP_PORT || !configs.FTP_USERNAME || !configs.FTP_PASSWORD) {
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

            client.on('ready', () => {
                client.put(buffer, remoteFilePath, (err: any) => {
                    if (err) {
                        logErrorToFile(err);
                        resolve({
                            success: false,
                            message: `FTP upload failed: ${err.message}`
                        });
                    } else {
                        console.log("---> Upload image to FTP: ", publicUrl);
                        resolve({
                            success: true,
                            message: "Image uploaded to FTP successfully",
                            url: publicUrl
                        });
                    }
                    client.end();
                });
            });

            client.on('error', (err: any) => {
                logErrorToFile(err);
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
                secure: configs.FTP_SECURE || false
            });

        } catch (error: any) {
            logErrorToFile(error);
            resolve({
                success: false,
                message: `FTP upload failed: ${error.message}`
            });
        }
    });
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
                return new Response(JSON.stringify({
                    success: false,
                    message: "Missing 'base64' field"
                }), { status: 400, headers: responseHeader });
            }

            const matches = jsonObj.base64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return new Response(JSON.stringify({
                    success: false,
                    message: "Invalid base64 format"
                }), { status: 400, headers: responseHeader });
            }

            const [, type, data] = matches;
            const prefixName = jsonObj.prefix_name || "image";
            const date = new Date();
            const dateString = `${date.getDate()}_${date.toLocaleString('default', { month: 'short' })}_${date.getFullYear()}-${date.getHours()}_${date.getMinutes()}_${date.getSeconds()}`;

            const filename = `${prefixName}-${dateString}.${type}`;
            const buffer = Buffer.from(data, "base64");

            const ftpResult = await uploadToFtp(buffer, filename);

            return new Response(JSON.stringify({
                success: ftpResult.success,
                message: ftpResult.message,
                public_url: ftpResult.url
            }), {
                status: ftpResult.success ? 200 : 500,
                headers: responseHeader
            });

        } catch (parseError: any) {
            return new Response(JSON.stringify({
                success: false,
                message: `Parse error: ${parseError.message}`
            }), { status: 400, headers: responseHeader });
        }

    } catch (error: any) {
        logErrorToFile(error);
        return new Response(JSON.stringify({
            success: false,
            message: `FTP upload failed: ${error.message}`
        }), { status: 500, headers: responseHeader });
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
        
        if (!file) {
            return new Response(JSON.stringify({ 
                success: false, 
                message: "No file provided" 
            }), { 
                status: 400, 
                headers: responseHeader 
            });
        }

        // Accept all file types - no restriction
        console.log(`---> Uploading file: ${file.name} (${file.type || 'unknown type'}, ${file.size} bytes)`);

        // Determine target path
        let targetPath = SAVE_PATH;
        if (print) {
            targetPath = PRINT_PATH;
        } else if (folder) {
            targetPath = path.join(SAVE_PATH, folder);
            if (!fs.existsSync(targetPath)) {
                fs.mkdirSync(targetPath, { recursive: true });
            }
        }

        // Generate filename
        const date = new Date();
        const dateString = `${date.getDate()}_${date.toLocaleString('default', { month: 'short' })}_${date.getFullYear()}-${date.getHours()}_${date.getMinutes()}_${date.getSeconds()}`;
        const fileExtension = path.extname(file.name) || '';
        const baseName = path.basename(file.name, fileExtension) || 'file';
        const filename = `${baseName}-${dateString}${fileExtension}`;
        
        // Save file
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = path.join(targetPath, filename);
        
        fs.writeFileSync(filePath, new Uint8Array(buffer));
        
        if (print) {
            console.log("---> Save file to PRINT_PATH: ", filePath);
        } else {
            console.log("---> Save file to SAVE_PATH: ", filePath);
        }

        // Handle FTP upload if requested
        if (ftp) {
            const ftpResult = await uploadToFtp(buffer, filename);
            if (ftpResult.success) {
                return new Response(JSON.stringify({
                    success: true,
                    message: "File uploaded successfully to both local and FTP",
                    local_path: filePath,
                    public_url: ftpResult.url,
                    file_info: {
                        name: file.name,
                        size: file.size,
                        type: file.type
                    }
                }), { 
                    status: 200, 
                    headers: responseHeader 
                });
            } else {
                return new Response(JSON.stringify({
                    success: true,
                    message: `File uploaded locally but FTP upload failed: ${ftpResult.message}`,
                    local_path: filePath,
                    file_info: {
                        name: file.name,
                        size: file.size,
                        type: file.type
                    }
                }), { 
                    status: 200, 
                    headers: responseHeader 
                });
            }
        }

        return new Response(JSON.stringify({
            success: true,
            message: "File uploaded successfully",
            local_path: filePath,
            file_info: {
                name: file.name,
                size: file.size,
                type: file.type
            }
        }), { 
            status: 200, 
            headers: responseHeader 
        });

    } catch (e: any) {
        logErrorToFile(e);
        return new Response(JSON.stringify({ 
            success: false, 
            message: e.message 
        }), { 
            status: 400, 
            headers: responseHeader 
        });
    }
}


const responseHeader = {
    "Content-Type": "application/json",
};


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
        return new Response(JSON.stringify({
            success: true,
            message: "Server is running"
        }), {
            status: 200,
            headers: responseHeader
        });
    } else if (req.method === "GET" && pathname === "/save_path") {
        return new Response(JSON.stringify({
            success: true,
            save_path: SAVE_PATH
        }), {
            status: 200,
            headers: responseHeader
        });

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
        return new Response(JSON.stringify({
            success: true,
            config: currentConfig
        }), {
            status: 200,
            headers: responseHeader
        });
    } else if (req.method === "POST" && pathname === "/config/reset") {
        // Reset config to default values
        try {
            resetConfigToDefault();
            return new Response(JSON.stringify({
                success: true,
                message: "Config has been reset to default values"
            }), {
                status: 200,
                headers: responseHeader
            });
        } catch (error: any) {
            return new Response(JSON.stringify({
                success: false,
                message: `Failed to reset config: ${error.message}`
            }), {
                status: 500,
                headers: responseHeader
            });
        }
    } else if (req.method === "POST" && pathname === "/config/update") {
        // Update specific config value
        try {
            const body = await req.json();
            const { key, value } = body;

            if (!key || value === undefined) {
                return new Response(JSON.stringify({
                    success: false,
                    message: "Missing 'key' or 'value' in request body"
                }), {
                    status: 400,
                    headers: responseHeader
                });
            }

            const success = updateConfigValue(key, value);
            return new Response(JSON.stringify({
                success,
                message: success ? `Updated ${key} to ${value}` : `Failed to update ${key}`
            }), {
                status: success ? 200 : 500,
                headers: responseHeader
            });
        } catch (error: any) {
            return new Response(JSON.stringify({
                success: false,
                message: `Failed to update config: ${error.message}`
            }), {
                status: 500,
                headers: responseHeader
            });
        }
    }
    else {
        return new Response(JSON.stringify({ success: false, message: "CANNOT GET: The requested resource was not found" }), { status: 404, headers: responseHeader });
    }
}

// Initialization
try {
    console.log("---> Save Image Folder : ", SAVE_PATH);
    console.log("---> Print Image Folder : ", PRINT_PATH);

    const server = serve({
        fetch: handleRequest,
        port: port,
    });

    //get ip address
    const ip = require('ip').address();


    console.log('---> Server is running on ' + ip + ':' + port);
} catch (e: any) {
    logErrorToFile(e);
    process.exit(1);
}
