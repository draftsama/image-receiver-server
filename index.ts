// import server from "bunrest";
// const app = server();
// const router = app.router();


// // Define a route
// router.get('/check', (req, res) => {
//     res.send('Hello World!');
// });

// app.use("/", router);


// app.listen(34213, () => {
//     console.log('App is listening on port 34213');
// });
const promise = () =>
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(true);
      }, 1);
    });

Bun.serve({
    port: 34213,
    async fetch(request, server) {
        const pathname = new URL(request.url).pathname;
        
      if (pathname === "/works") {
        return new Response(`Your IP is ${server.requestIP(request)?.address}`);
      }
  
      if (pathname === "/fails") {
        await promise();
        return new Response(`Your IP is ${server.requestIP(request)?.address}`);
      }
  
      return new Response("404");
    },
  });