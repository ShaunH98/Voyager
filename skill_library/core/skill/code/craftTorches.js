async function craftTorches(bot) {
  if (!(await obtainItem(bot, "coal", 2))) { await obtainItem(bot, "charcoal", 2); }
  await obtainItem(bot, "torch", 8);
}