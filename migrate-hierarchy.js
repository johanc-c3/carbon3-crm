const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const adapter = new PrismaBetterSqlite3({ url: 'file:./dev.db' });
const prisma = new PrismaClient({ adapter });

async function migrate() {
    console.log("🚀 Starting Carbon3 Global Hierarchy Migration...");

    try {
        // 1. Ensure a "Global" or "Default" Region exists
        const defaultRegion = await prisma.region.upsert({
            where: { id: 1 },
            update: {},
            create: { name: "Global Headquarters" }
        });
        console.log(`✅ Default Region: ${defaultRegion.name}`);

        // 2. Link orphaned distributors to Global
        const distributors = await prisma.distributor.updateMany({
            where: { regionId: null },
            data: { regionId: defaultRegion.id }
        });
        console.log(`✅ Linked ${distributors.count} orphaned distributors to Global.`);

        // 3. Link orphaned agents to Global
        const agents = await prisma.agent.updateMany({
            where: { regionId: null },
            data: { regionId: defaultRegion.id }
        });
        console.log(`✅ Normalized ${agents.count} agents for regional hierarchy.`);

        console.log("✨ Migration Complete. Relational streams are synchronized.");
    } catch (error) {
        console.error("❌ Migration Failed:", error.message);
    } finally {
        await prisma.$disconnect();
    }
}

migrate();

