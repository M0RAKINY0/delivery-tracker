import { defineConfig } from "drizzle-kit";

export default({
    dialect: 'postgresql',
    schema: './src/db/schema.ts'
});