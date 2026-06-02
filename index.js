const express = require('express');
// FIX: Point this back to the standard node_modules location
const { PrismaClient } = require('@prisma/client'); 
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const app = express();

// ==========================================
// 1. PRISMA 7 DRIVER ADAPTER INITIALIZATION
// ==========================================
const adapter = new PrismaBetterSqlite3({ url: 'file:./dev.db' });
const prisma = new PrismaClient({ adapter });

app.use(express.json());
app.use(express.static('public'));

// ==========================================
// 2. REGION ENDPOINTS 
// ==========================================

// Create a Region (e.g., "North America", "Europe", "Global")
app.post('/regions', async (req, res) => {
  const { name } = req.body;
  try {
    const region = await prisma.region.create({ data: { name } });
    res.status(201).json(region);
  } catch (error) {
    res.status(400).json({ error: "Region already exists or invalid data.", details: error.message });
  }
});

// ==========================================
// 3. DISTRIBUTOR ENDPOINTS
// ==========================================

// Create a Distributor inside a Region or Global
app.post('/distributors', async (req, res) => {
  const { name, regionId } = req.body;
  try {
    const distributor = await prisma.distributor.create({
      data: { name, regionId: parseInt(regionId) }
    });
    res.status(201).json(distributor);
  } catch (error) {
    res.status(400).json({ error: "Failed to create distributor.", details: error.message });
  }
});

// Move a Distributor to a new Region (e.g., transferring to "Global")
app.put('/distributors/:id/move', async (req, res) => {
  const { id } = req.params;
  const { targetRegionId } = req.body;
  try {
    const updatedDistributor = await prisma.distributor.update({
      where: { id: parseInt(id) },
      data: { regionId: parseInt(targetRegionId) }
    });
    res.json({ message: "Distributor moved territories successfully", updatedDistributor });
  } catch (error) {
    res.status(400).json({ error: "Failed to move distributor. Verify IDs.", details: error.message });
  }
});

// ==========================================
// 4. AGENT ENDPOINTS
// ==========================================

// Create an Agent inside a Region
app.post('/agents', async (req, res) => {
  const { name, regionId } = req.body;
  try {
    const agent = await prisma.agent.create({
      data: { name, regionId: parseInt(regionId) }
    });
    res.status(201).json(agent);
  } catch (error) {
    res.status(400).json({ error: "Failed to create agent.", details: error.message });
  }
});

// ==========================================
// 5. CUSTOMER ENDPOINTS
// ==========================================

// Create a Customer (tied to a Region, and optionally directly to a Distributor/Agent)
app.post('/customers', async (req, res) => {
  const { name, regionId, distributorId, agentId } = req.body;
  try {
    const customer = await prisma.customer.create({
      data: {
        name,
        regionId: parseInt(regionId),
        distributorId: distributorId ? parseInt(distributorId) : null,
        agentId: agentId ? parseInt(agentId) : null
      }
    });
    res.status(201).json(customer);
  } catch (error) {
    res.status(400).json({ error: "Failed to create customer.", details: error.message });
  }
});

// ==========================================
// 6. MATRIX LINKING RELATIONSHIPS
// ==========================================

// Link an Agent and a Distributor together (Many-to-Many matrix)
app.post('/link-agent-distributor', async (req, res) => {
  const { agentId, distributorId } = req.body;
  try {
    const updatedAgent = await prisma.agent.update({
      where: { id: parseInt(agentId) },
      data: {
        distributors: {
          connect: { id: parseInt(distributorId) }
        }
      },
      include: { distributors: true }
    });
    res.json({ message: "Agent and Distributor matrix cross-linked successfully", updatedAgent });
  } catch (error) {
    res.status(400).json({ error: "Failed to bridge network link.", details: error.message });
  }
});

// ==========================================
// 7. BIRD'S-EYE VIEW SYSTEM DASHBOARD
// ==========================================

// Fetch Carbon3 Global's full mapped organizational hierarchy
app.get('/network', async (req, res) => {
  try {
    const network = await prisma.region.findMany({
      include: {
        distributors: {
          include: { agents: true }
        },
        agents: {
          include: { distributors: true }
        },
        customers: true,
      }
    });
    res.json(network);
  } catch (error) {
    res.status(500).json({ error: "Internal hierarchy query failed.", details: error.message });
  }
});

// Server Initialization
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Carbon3 CRM operational on http://localhost:${PORT}`);
});