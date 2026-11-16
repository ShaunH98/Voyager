// Building and home life. Structures are built from fixed blueprints, gathering all materials
// themselves (cobblestone, planks, a bed, door, fences...), and every block is checked afterwards.
// The home base (where home is, what has been built) is remembered: getBase(bot) returns
// { home: {x,y,z} | null, structures: [{ type, origin, box, ok, marks }] }.

// Build a 5x5 stone cottage with a bed, chest, crafting table, furnace and door; it becomes home: await buildHome(bot);
async function buildHome(bot) {}
// Build a row of 4 chests next to home: await buildStorage(bot);
async function buildStorage(bot) {}
// Take junk and surplus blocks to the storage chests at home (builds them if needed): await storeItems(bot);
async function storeItems(bot) {}
// Build a fenced, watered 7x7 wheat field near home and plant it: await buildWheatFarm(bot);
async function buildWheatFarm(bot) {}
// Harvest ripe wheat at the home farm and replant, returns wheat gained: await harvestFarm(bot);
async function harvestFarm(bot) {}
// Build a fenced pen near home and lead `count` animals into it with their food: await buildAnimalPen(bot, "cow", 2);
async function buildAnimalPen(bot, animal = "cow", count = 2) {}
// Feed two adult animals so they breed: await breedAnimals(bot, "cow");
async function breedAnimals(bot, animal = "cow") {}
// At night: walk home, go inside and sleep in the bed (false if there is no home or it is daytime): await sleepAtHome(bot);
async function sleepAtHome(bot) {}
// Walk back to the home door: await goHome(bot);
async function goHome(bot) {}
// Step out of the hut through the door: await leaveHome(bot);
async function leaveHome(bot) {}
// Build any blueprint by name ("hut", "storage", "farm", "pen"): await buildStructure(bot, "farm");
async function buildStructure(bot, type) {}
