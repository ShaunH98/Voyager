"""Benchmark tasks. `check` is a JavaScript expression evaluated in the bot after the run.

`count("regex")` = how many matching items the bot holds; `armor(slot)` = item name worn
(head/chest/legs/feet); `near("zombie", 16)` = is such a mob within 16 blocks.
`skills` = candidate skill names, first one present in the library under test is called.
"""

LOGS = "oak_log|birch_log|spruce_log|jungle_log|acacia_log|dark_oak_log|mangrove_log"
PLANKS = LOGS.replace("_log", "_planks")
MEAT = "cooked_beef|cooked_porkchop|cooked_mutton|cooked_chicken|cooked_rabbit|cooked_cod|cooked_salmon"

STONE_KIT = {"stone_pickaxe": 1, "stone_axe": 1, "stone_sword": 1, "crafting_table": 1, "stick": 8}
IRON_KIT = {"iron_pickaxe": 1, "iron_sword": 1, "stone_axe": 1, "crafting_table": 1, "furnace": 1, "stick": 8, "coal": 16}

TASKS = [
    # ---- wood / basics
    {"id": "logs", "skills": ["mineThreeMoreOakLogs", "chopSpruceLogs", "chopDownSpruceLogs", "obtainBirchLogs", "mineWoodLog"],
     "inventory": {}, "check": f'count("{LOGS}") >= 3'},
    {"id": "planks_sticks", "skills": ["craftOakPlanksAndSticks", "craftWoodenPlanks", "craftSticks", "craftEightSticks"],
     "inventory": {"oak_log": 4}, "check": 'count("stick") >= 4'},
    {"id": "crafting_table", "skills": ["craftCraftingTable"],
     "inventory": {"oak_log": 2}, "check": 'count("crafting_table") >= 1'},
    {"id": "wooden_pickaxe", "skills": ["craftWoodenPickaxe"],
     "inventory": {"oak_log": 3}, "check": 'count("wooden_pickaxe") >= 1'},
    {"id": "cobblestone", "skills": ["mineTenCobblestone", "mineEightCobblestone"],
     "inventory": {"wooden_pickaxe": 1}, "check": 'count("cobblestone|cobbled_deepslate") >= 8'},
    {"id": "stone_pickaxe", "skills": ["craftStonePickaxe"],
     "inventory": {"wooden_pickaxe": 1, "crafting_table": 1, "stick": 4}, "check": 'count("stone_pickaxe") >= 1'},
    {"id": "stone_tools", "skills": ["craftStoneTools"],
     "inventory": {"wooden_pickaxe": 1, "crafting_table": 1, "stick": 8},
     "check": 'count("stone_pickaxe") && count("stone_axe") && count("stone_sword") && count("stone_shovel")'},
    {"id": "furnace", "skills": ["craftFurnace"],
     "inventory": {"wooden_pickaxe": 1, "crafting_table": 1}, "check": 'count("furnace") >= 1'},
    {"id": "torches", "skills": ["craftEightTorches", "craftTorches", "craftSixteenTorches"],
     "inventory": dict(STONE_KIT), "check": 'count("torch") >= 8'},
    {"id": "chest", "skills": ["craftChest"],
     "inventory": {"stone_axe": 1, "crafting_table": 1}, "check": 'count("chest") >= 1'},
    # ---- ores / smelting
    {"id": "coal", "skills": ["mineFiveCoalOres", "mineFiveCoalOre", "mineFourCoalOre", "mineCoalOre"],
     "inventory": {"stone_pickaxe": 1}, "check": 'count("coal") >= 4'},
    {"id": "iron_ingots", "skills": ["smeltFiveRawIron", "smeltRawIron", "smeltSixRawIron", "smeltOneRawIron"],
     "inventory": dict(STONE_KIT, furnace=1, coal=8), "check": 'count("iron_ingot") >= 1'},
    {"id": "iron_pickaxe", "skills": ["craftIronPickaxe", "craftIronPickaxeWithMaterials"],
     "inventory": dict(STONE_KIT, furnace=1, coal=8), "check": 'count("iron_pickaxe") >= 1'},
    {"id": "iron_sword", "skills": ["craftIronSword"],
     "inventory": dict(STONE_KIT, furnace=1, coal=8), "check": 'count("iron_sword") >= 1'},
    {"id": "bucket", "skills": ["craftBucket"],
     "inventory": dict(STONE_KIT, furnace=1, coal=8), "check": 'count("bucket|water_bucket") >= 1'},
    {"id": "water_bucket", "skills": ["fillBucketWithWater", "collectWaterWithBucket"],
     "inventory": {"bucket": 1}, "check": 'count("water_bucket") >= 1', "spread": 60},
    {"id": "shield", "skills": ["craftShield", "craftShieldImproved", "craftShieldWithFurnace"],
     "inventory": dict(STONE_KIT, furnace=1, coal=8), "check": 'count("shield") >= 1'},
    {"id": "copper", "skills": ["smeltRawCopper", "smeltFiveRawCopper", "smeltThreeRawCopper", "mineFiveCopperOres"],
     "inventory": dict(STONE_KIT, furnace=1, coal=8), "check": 'count("copper_ingot|raw_copper") >= 3'},
    {"id": "iron_armor", "skills": ["equipIronArmor"], "timeout": 600,
     "inventory": dict(STONE_KIT, furnace=1, coal=32),
     "check": 'armor("head")=="iron_helmet" && armor("chest")=="iron_chestplate" && armor("legs")=="iron_leggings" && armor("feet")=="iron_boots"'},
    {"id": "diamond", "skills": ["mineDiamond", "mineDiamonds"],
     "inventory": dict(IRON_KIT, torch=16), "check": 'count("diamond") >= 1'},
    {"id": "diamond_pickaxe", "skills": ["craftDiamondPickaxe"], "timeout": 900,
     "inventory": dict(IRON_KIT, torch=16), "check": 'count("diamond_pickaxe") >= 1'},
    # ---- animals / food
    {"id": "wool_bed", "skills": ["craftWhiteBed", "craftWhiteBedWithExploration"],
     "inventory": dict(STONE_KIT), "check": 'count(".*_bed") >= 1', "spread": 80},
    {"id": "cooked_meat", "skills": ["cookMeat", "cookPorkchops", "cookRawBeef", "cookMutton", "cookChicken", "cookRawMutton",
                                     "cookSevenMutton", "cookThreeRawChicken"],
     "inventory": dict(STONE_KIT, furnace=1, coal=8), "check": f'count("{MEAT}") >= 2', "spread": 80},
    {"id": "eat_when_hungry", "skills": ["eatWhenHungry", "eatCookedMuttonIfHungry", "eatCookedMutton", "eatCookedBeef"],
     "inventory": {"cooked_beef": 4, "cooked_mutton": 4},
     "difficulty": "easy", "commands": ["/effect give @s minecraft:hunger 8 255 true"], "settle": 180,
     "check": "__foodBefore <= 10 && bot.food >= 14"},
    {"id": "fish", "skills": ["catchThreeFish", "catchFiveFishSafely", "fishInNearbyWaterSafely"],
     "inventory": {"fishing_rod": 1}, "check": 'count("cod|salmon|tropical_fish|pufferfish") >= 1', "spread": 60},
    {"id": "farm_wheat", "skills": ["plantAndHarvestWheat", "farmWheat"],
     "inventory": {"stone_hoe": 1, "wheat_seeds": 8, "bone_meal": 32, "water_bucket": 1}, "check": 'count("wheat") >= 3'},
    # ---- combat / survival
    {"id": "kill_zombie", "skills": ["killOneZombie", "killZombie"], "difficulty": "easy",
     "inventory": {"iron_sword": 1, "shield": 1}, "equipment": [None, "iron_chestplate", None, None, None, None],
     "commands": ["/summon minecraft:zombie ~6 ~ ~"], "check": '!near("zombie", 24)'},
    {"id": "kill_spider", "skills": ["killOneSpider", "killSpider"], "difficulty": "easy",
     "inventory": {"iron_sword": 1}, "equipment": [None, "iron_chestplate", None, None, None, None],
     "commands": ["/summon minecraft:spider ~6 ~ ~"], "check": '!near("spider", 24)'},
    {"id": "kill_skeleton", "skills": ["killSkeleton", "killOneSkeleton"], "difficulty": "easy",
     "inventory": {"iron_sword": 1, "shield": 1}, "equipment": [None, "iron_chestplate", None, None, None, None],
     "commands": ["/summon minecraft:skeleton ~8 ~ ~"], "check": '!near("skeleton", 24)'},
    {"id": "survive_night", "skills": ["surviveTheNight"], "difficulty": "normal", "time": "13000",
     "inventory": {"stone_sword": 1, "stone_pickaxe": 1, "cooked_beef": 8, "torch": 16, "cobblestone": 64, "oak_planks": 32},
     "commands": ["/summon minecraft:zombie ~10 ~ ~", "/summon minecraft:zombie ~-10 ~ ~5",
                  "/summon minecraft:skeleton ~8 ~ ~-8"],
     "check": "bot.health > 0"},
    # ---- from scratch (empty inventory): the full tech tree
    {"id": "scratch_stone_pickaxe", "skills": [], "call": 'await obtainItem(bot, "stone_pickaxe", 1);',
     "inventory": {}, "check": 'count("stone_pickaxe") >= 1'},
    {"id": "scratch_iron_pickaxe", "skills": [], "call": 'await obtainItem(bot, "iron_pickaxe", 1);',
     "inventory": {}, "check": 'count("iron_pickaxe") >= 1'},
]
