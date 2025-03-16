import { serve } from "bun";
import fs from "fs";
import path from "path";

// Constants
const CONFIG_PATH = path.resolve('./config.txt');
const ERROR_LOG_PATH = path.resolve('./error.log');
const DEFAULT_SAVE_PATH = path.resolve('./SAVE_IMAGES');
const AP_KEY = "tyI45KBNFS8hrGOdzjvwrG2c7J2odGVs";

createDefaultConfig();
const configs = parseConfigFile();
const SAVE_PATH = ensureSavePath(configs["SAVE_PATH"] as string || DEFAULT_SAVE_PATH);
const port = configs["PORT"] as number || 5555;

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
        fs.writeFileSync(CONFIG_PATH, `SAVE_PATH="${DEFAULT_SAVE_PATH}"\nPORT=5555\n`);
    } else {
        console.log("---> Config file : ", CONFIG_PATH);
    }

}

// Parse config file into an object
function parseConfigFile(): Record<string, string | number | boolean | undefined> {
    const configs: Record<string, string | number | boolean | undefined> = {};
    const lines = fs.readFileSync(CONFIG_PATH, "utf-8").split("\n");
    lines.forEach(line => {
        const [key, value] = line.split("=");
        if (value === "TRUE" || value === "true") {
            configs[key] = true;
        } else if (value === "FALSE" || value === "false") {
            configs[key] = false;
        } else if (!isNaN(Number(value))) {
            configs[key] = Number(value);
        } else {
            configs[key] = value ? value.replace(/"/g, "") : undefined;
        }
    });
    return configs;
}

// Ensure the save path exists
function ensureSavePath(savePath: string): string {
    if (!fs.existsSync(savePath)) {
        console.log("---> 'SAVE_PATH' Directory not exist");
        fs.mkdirSync(savePath, { recursive: true });
        console.log("---> Create a default save images directory");
    }
    return savePath;
}

// Upload image in base64 format
async function uploadImage(req: Request, savePath: string): Promise<Response> {
    const encoded = await req.text();
    const payload = decodeURIComponent(encoded);

    let jsonObj: { base64: string; prefix_name?: string , folder?: string };


    try {
        jsonObj = JSON.parse(payload);
        if (!jsonObj.base64) {

            return new Response(JSON.stringify({ success: false, message: "Missing 'base64' field" }), { status: 400, headers: responseHeader });
        }

        const matches = jsonObj.base64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return new Response(JSON.stringify({ success: false, message: "Invalid base64 format" }), { status: 400, headers: responseHeader });
        }

        if (jsonObj.folder) {
            savePath = path.join(savePath, jsonObj.folder);
            if (!
                fs.existsSync(savePath)) {
                fs.mkdirSync(savePath, { recursive: true });
            }
        }


        const [, type, data] = matches;
        const prefixName = jsonObj.prefix_name || "image";
        const filename = `${prefixName}_${Date.now()}.${type}`;
        const buffer = Buffer.from(data, "base64");
        const filePath = path.join(savePath, filename);

        fs.writeFileSync(filePath, new Uint8Array(buffer));
        console.log("---> Save image to : ", filePath);

        return new Response(
            JSON.stringify({ success: true, message: "Image uploaded successfully", path: filePath }),
            { status: 200, headers: responseHeader }
        );
    } catch (e: any) {
        logErrorToFile(e);
        return new Response(JSON.stringify({ success: false, message: e.message }), { status: 400, headers: responseHeader });
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

    } else if (req.method === "POST" && pathname === "/upload") {
        return uploadImage(req, SAVE_PATH);
    } else {
        return new Response(JSON.stringify({ success: false, message: "CANNOT GET: The requested resource was not found" }), { status: 404, headers: responseHeader });
    }
}

// Initialization
try {
    console.log("---> Save Image Folder : ", SAVE_PATH);

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
