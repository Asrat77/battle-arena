import { createApp } from "./app";

const PORT = Number(process.env.PORT) || 3001;
const { httpServer } = createApp();

httpServer.listen(PORT, () => {
  console.log(`Battle Arena server listening on ${PORT}`);
});
