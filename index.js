const express = require('express');
const { PrismaClient } = require('@prisma/client'); 
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const crypto = require('crypto'); // Native secure hashing

const app = express();

const adapter = new PrismaBetterSqlite3({ url: 'file:./dev.db' });
const prisma = new PrismaClient({ adapter });

app.use(express.json());
app.use(express.static('public'));

// Helper function to securely hash passwords without external libraries
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// ==========================================
// 1. GOVERNED AUTHENTICATION ENDPOINTS
// ==========================================

// Initial admin/user registration point
app.post('/auth/register', async (req, res) => {
    const { email, name, password, role } = req.body;
    try {
        const allowedRoles = ["ADMIN", "MANAGER", "STAFF"];
        const targetRole = allowedRoles.includes(role?.toUpperCase()) ? role.toUpperCase() : "STAFF";

        const user = await prisma.user.create({
            data: {
                email: email.toLowerCase().trim(),
                name,
                password: hashPassword(password),
                role: targetRole
            }
        });
        res.status(201).json({ message: "User profile provisioned", user: { id: user.id, email: user.email, role: user.role } });
    } catch (error) {
        res.status(400).json({ error: "Registration failed. Email might already exist." });
    }
});

// User Validation Gate (Login)
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
        if (!user || user.password !== hashPassword(password)) {
            return res.status(401).json({ error: "Invalid credential parameters." });
        }
        // Send profile tokens back to client browser storage
        res.json({ name: user.name, role: user.role, email: user.email });
    } catch (error) {
        res.status(500).json({ error: "Authentication transaction loop broken." });
    }
});

// Access Token Authentication Middleware
function checkAccess(requiredRoles) {
    return (req, res, next) => {
        const userRole = req.headers['x-user-role'];
        if (!userRole || !requiredRoles.includes(userRole.toUpperCase())) {
            return res.status(403).json({ error: "Access Denied: Your assigned corporate tier lacks authorization clearance." });
        }
        next();
    };
}
// ==========================================
// 2. HIERARCHICAL SYSTEM DASHBOARD
// ==========================================
app.get('/network', async (req, res) => {
    try {
        const network = await prisma.region.findMany({
            include: {
                distributors: {
                    include: { 
                        subDistributors: true, 
                        agents: true,
                        customers: true 
                    }
                },
                agents: {
                    include: { 
                        subAgents: true, 
                        distributors: true,
                        customers: true 
                    }
                },
                customers: true
            }
        });
        res.json(network);
    } catch (error) {
        res.status(500).json({ error: "Hierarchy build failed.", details: error.message });
    }
});

// ==========================================
// 3. PROVISIONING ENGINE (GOVERNED POSTS)
// ==========================================
app.post('/regions', checkAccess(['ADMIN']), async (req, res) => {
    const { name } = req.body;
    try {
        const region = await prisma.region.create({ data: { name: name.trim() } });
        res.status(201).json(region);
    } catch (error) { res.status(400).json({ error: "Failed to save region." }); }
});

app.post('/distributors', checkAccess(['ADMIN', 'MANAGER']), async (req, res) => {
    const { name, regionId, parentDistributorId } = req.body;
    try {
        const distributor = await prisma.distributor.create({
            data: { name, regionId: parseInt(regionId), parentDistributorId: parentDistributorId ? parseInt(parentDistributorId) : null }
        });
        res.status(201).json(distributor);
    } catch (error) { res.status(400).json({ error: "Failed to create distributor." }); }
});

app.post('/agents', checkAccess(['ADMIN', 'MANAGER']), async (req, res) => {
    const { name, regionId, distributorId, parentAgentId } = req.body;
    try {
        const agent = await prisma.agent.create({
            data: { name, regionId: parseInt(regionId), parentAgentId: parentAgentId ? parseInt(parentAgentId) : null }
        });
        if (distributorId) {
            await prisma.agent.update({ where: { id: agent.id }, data: { distributors: { connect: { id: parseInt(distributorId) } } } });
        }
        res.status(201).json(agent);
    } catch (error) { res.status(400).json({ error: "Failed to create agent account." }); }
});

app.post('/customers', checkAccess(['ADMIN', 'MANAGER']), async (req, res) => {
    const { name, regionId, distributorId, agentId } = req.body;
    try {
        const customer = await prisma.customer.create({
            data: { name, regionId: parseInt(regionId), distributorId: distributorId ? parseInt(distributorId) : null, agentId: agentId ? parseInt(agentId) : null }
        });
        res.status(201).json(customer);
    } catch (error) { res.status(400).json({ error: "Failed to onboard customer profile." }); }
});

// ==========================================
// 4. PIPELINE REASSIGNMENT (GOVERNED PUTS)
// ==========================================
app.put('/distributors/:id/move', checkAccess(['ADMIN']), async (req, res) => {
    const { regionId, parentDistributorId } = req.body;
    try {
        const updated = await prisma.distributor.update({
            where: { id: parseInt(req.params.id) },
            data: { regionId: parseInt(regionId), parentDistributorId: parentDistributorId ? parseInt(parentDistributorId) : null }
        });
        res.json(updated);
    } catch (error) { res.status(400).json({ error: "Distributor transfer failed." }); }
});

app.put('/agents/:id/move', checkAccess(['ADMIN']), async (req, res) => {
    const { regionId, parentAgentId, connectDistId, disconnectDistId } = req.body;
    try {
        const updateData = { regionId: parseInt(regionId), parentAgentId: parentAgentId ? parseInt(parentAgentId) : null };
        if (connectDistId || disconnectDistId) {
            updateData.distributors = {};
            if (connectDistId) updateData.distributors.connect = { id: parseInt(connectDistId) };
            if (disconnectDistId) updateData.distributors.disconnect = { id: parseInt(disconnectDistId) };
        }
        const updated = await prisma.agent.update({ where: { id: parseInt(req.params.id) }, data: updateData });
        res.json(updated);
    } catch (error) { res.status(400).json({ error: "Agent transfer failed." }); }
});

app.put('/customers/:id/move', checkAccess(['ADMIN', 'MANAGER']), async (req, res) => {
    const { regionId, distributorId, agentId } = req.body;
    try {
        const updated = await prisma.customer.update({
            where: { id: parseInt(req.params.id) },
            data: { regionId: parseInt(regionId), distributorId: distributorId ? parseInt(distributorId) : null, agentId: agentId ? parseInt(agentId) : null }
        });
        res.json(updated);
    } catch (error) { res.status(400).json({ error: "Customer reassignment failed." }); }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Carbon3 CRM operational on http://localhost:${PORT}`));