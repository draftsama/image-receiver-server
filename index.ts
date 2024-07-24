import server from "bunrest";
import multer from "multer"; // Import multer for handling file uploads
import fs from "fs";
import path from "path";

const app = server();
const api_router = app.router();


const AP_KEY = "tyI45KBNFS8hrGOdzjvwrG2c7J2odGVs"
const DEFAULT_SAVE_PATH = path.join(__dirname, "SAVE_IMAGES");

//get directory of this file

// console.log("dirname", __dirname);


//middleware to check the api key
app.use((req, res, next) => {
    const api_key = req.headers!['api-key'] as string;

    //if api key is not present
    if (!api_key) {
        res.status(401).json({ message: "Require api-key" });
        return;
    }

    if (api_key !== AP_KEY) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    next!();
});



api_router.get("/check", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Server is running"
    });
})


const config_path = path.join(__dirname, "config.txt");

//if config file not exist then create a default config file
if (!fs.existsSync(config_path)) {
    console.log("---> Create a default config file");

    fs.writeFileSync(config_path, `SAVE_PATH="${DEFAULT_SAVE_PATH}"\nPORT=5555\n`);
} else {
    console.log("---> Config file : ", config_path);
}


//assign to dic
let configs: Record<string, string | number | boolean | undefined> = {};

const lines = fs.readFileSync(config_path, "utf-8").split("\n");
for (const line of lines) {
    const [key, value] = line.split("=");

    //try cast value to boolean
    if (value === "TRUE" || value === "true") {
        configs[key] = true;
    } else if (value === "FALSE" || value === "false") {
        configs[key] = false;
    }
    //try cast value to number
    else if (!isNaN(Number(value))) {
        configs[key] = Number(value);
    } else {

        //if not boolean or number then assign as string
        //remove " in value
        configs[key] = value ? value.replace(/"/g, "") : undefined;
    }


}

let SAVE_PATH = configs["SAVE_PATH"] as string;
//if save path not exist then create a default save path

const port = configs["PORT"] as number || 5555;


if (!fs.existsSync(SAVE_PATH)) {

    console.log("---> 'SAVE_PATH' Directory not exist");
    SAVE_PATH = DEFAULT_SAVE_PATH;

    if (!fs.existsSync(SAVE_PATH)) {
        console.log("---> Create a default save images directory");
        fs.mkdirSync(SAVE_PATH, { recursive: true });
    }

}
console.log("---> 'SAVE_PATH' Directory : ", SAVE_PATH);



//upload image base64 format 
app.post("/upload", (req, res) => {


    if (!req.body) {
        res.status(400).json({
            message: 'No query provided'
        });
        return;
    }

    let jsonObj = req.body as { base64: string, prefix_name: string }
    try {
        const body = decodeURIComponent(req.body.toString())
        jsonObj = JSON.parse(body) as { base64: string, prefix_name: string };

        if (jsonObj.base64 === undefined) {
            throw new Error("No image uploaded");
        }

        // Decode the base64 image
        const matches = jsonObj.base64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) { 
            throw new Error("Invalid image format or data");
        }
    

        const [, type, data] = matches;
        const prefix_name = jsonObj.prefix_name ? jsonObj.prefix_name : "image";
        const filename = `${prefix_name}_${Date.now()}.${type}`;

        // Save the image to the file system
        const buffer = Buffer.from(data, "base64");
        const file_path = path.join(SAVE_PATH, filename);

        fs.writeFileSync(file_path,new Uint8Array(buffer));
        
        console.log("---> Save image to : ", file_path);
        
        res.status(200).json({
            success: true,
            message: "Image uploaded successfully",
            path: file_path,
        });

    } catch (e : any) {

        res.status(400).json({
            success: false,
            message: e.message
        });
        return;
    }



   
});



app.use("/", api_router);


app.listen(port, () => {
    //get ip address
    const ip = require("ip").address();
    console.log('---> Server is running at :' + ip + ":" + port);
});

