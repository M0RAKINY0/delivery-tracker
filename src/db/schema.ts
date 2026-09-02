import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
  doublePrecision,
} from "drizzle-orm/pg-core";


export const userTable = pgTable("Couriers",{
    id: uuid("id").defaultRandom().primaryKey(),
    name: text(),
});

export const shipment =pgTable("shipment",{
    id: uuid().primaryKey(),
    trackingNumber: varchar().unique(),
    pickupAddress: varchar().notNull(),
    dropOff: varchar().notNull(),
    courierId: uuid().references(()=> userTable.id),
    status: varchar().notNull().default("pending"),
    currentLocation: text(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const LocationPings = pgTable("real time location",{
    id: uuid(),
    courierId: uuid().references(()=> userTable.id),
    longitude: doublePrecision("latitude"),
    latitude: doublePrecision("longitude"),
});



//ai generated demo 
// import {
//   integer,
//   pgTable,
//   serial,
//   text,
//   timestamp,
// } from "drizzle-orm/pg-core";

// export const deliveries = pgTable("deliveries", {
//   id: serial("id").primaryKey(),
//   trackingNumber: text("tracking_number").notNull().unique(),
//   status: text("status").notNull().default("pending"),
//   currentLocation: text("current_location"),
//   createdAt: timestamp("created_at").defaultNow().notNull(),
//   updatedAt: timestamp("updated_at").defaultNow().notNull(),
// });