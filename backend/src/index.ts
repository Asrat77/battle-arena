import { createApp } from "./app";

const PORT = Number(process.env.PORT) || 3001;
const { httpServer, withdrawals } = createApp();
// Telegram button taps and replies from moderators (no-op unless withdrawals are on).
withdrawals.start();

httpServer.listen(PORT, () => {
  console.log(`Battle Arena server listening on ${PORT}`);
});
