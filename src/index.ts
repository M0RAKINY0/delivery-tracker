import Fastify from "fastify";
const app = Fastify({ logger: true });


app.get('/health', async (request, reply)=>{
    return {status: 'ok'};
});



const start = async () => {
    try {
        const port = Number(process.env.PORT ?? 3232)
        await app.listen({ port })
    }catch(err){
        app.log.error(err)
        process.exit(1)
    }
}

start()

