import server from "bunrest";
const app = server();
const router = app.router();


// Define a route
router.get('/check', (req, res) => {
    res.send('Hello World!');
});

app.use("/", router);


app.listen(34213, () => {
    console.log('App is listening on port 34213');
});