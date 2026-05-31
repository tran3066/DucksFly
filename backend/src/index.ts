import { createGameServer } from "./app";

const port = Number(process.env.PORT ?? 2567);

createGameServer()
  .listen(port)
  .then(() => {
    console.log(`DucksFly server listening on ws://localhost:${port}`);
  })
  .catch((err) => {
    console.error("Failed to start DucksFly server:", err);
    process.exit(1);
  });
