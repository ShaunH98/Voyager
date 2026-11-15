async function killOneZombie(bot) {
  await equipBestGear(bot);
  await killMob(bot, "zombie", 120);
}