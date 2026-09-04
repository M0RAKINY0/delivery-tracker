import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { 
    Courier,
    LocationPings 

} from "../db/schema.js";

export async function getCourier(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const couriers = await db.select().from(Courier);
    return reply.send(couriers);
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: "Unable to fetch couriers" });
  }
}

export async function getCurrentLocation( 
    request: FastifyRequest,
    reply: FastifyReply,
) {
    
    try {
        const currentLocation = await db.select().from(LocationPings);
        return reply.send(LocationPings)
    }catch (error){
        request.log.error(error);
    return reply.code(500).send({ error: "Unable to fetch couriers" });

    }
}