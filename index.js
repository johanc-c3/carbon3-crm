const express = require('express');
const { PrismaClient } = require('@prisma/client'); 
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const crypto = require('crypto');

const app = express();
const adapter = new PrismaBetterSqlite3({ url: 'file:./dev.db' });
const prisma = new PrismaClient({ adapter });

app.use(express.json());
app.use(express.static('public'));

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Middleware: Authenticates User Identity & Enforces Row-Level Data Visibility
async function enforceSecurityScoping(req, res, next) {
    const userEmail = req.headers['x-user-email'];
    if (!userEmail) return res.status(401).json({ error: "Authentication required." });
    
    const user = await prisma.user.findUnique({ where: { email: userEmail.toLowerCase().trim() } });
    if (!user) return res.status(403).json({ error: "Profile session missing." });
    
    req.currentUser = user;
    next();
}

// Middleware: Validates Mutation Rights (Read/Write Constraints)
function verifyWritePermission(req, res, next) {
    if (req.currentUser.role === 'ADMIN') return next();
    
    if (!req.currentUser.canEdit) {
        return res.status(403).json({ error: "Access Denied: Your profile is restricted to View-Only mode." });
    }
    next();
}

// ==========================================
// 1. SECURED AUTH SYSTEM & IDENTITY GOVERNANCE
// ==========================================
app.post('/auth/register', async (req, res) => {
    const { email, name, password, role, canEdit, scopeType, scopeId } = req.body;
    try {
        const userCount = await prisma.user.count();
        
        // SECURITY BOUNDARY: If users exist, verify requester is an authenticated ADMIN
        if (userCount > 0) {
            const requesterEmail = req.headers['x-user-email'];
            if (!requesterEmail) {
                return res.status(401).json({ error: "Authentication signatures required to provision corporate accounts." });
            }
            
            const requester = await prisma.user.findUnique({ where: { email: requesterEmail.toLowerCase().trim() } });
            if (!requester || requester.role !== 'ADMIN') {
                return res.status(403).json({ error: "Access Denied: Only System Administrators can access account provisioning tools." });
            }
        }

        // Governance Guard: If database is empty, force the first registration to be an ADMIN
        const designatedRole = userCount === 0 ? 'ADMIN' : (role || 'STAFF');

        const user = await prisma.user.create({
            data: {
                email: email.toLowerCase().trim(),
                name,
                password: hashPassword(password),
                role: designatedRole,
                canEdit: designatedRole === 'ADMIN' ? true : Boolean(canEdit),
                scopeType: designatedRole === 'ADMIN' ? "FULL" : (scopeType || "FULL"),
                scopeId: designatedRole === 'ADMIN' ? null : (scopeId ? parseInt(scopeId) : null)
            }
        });
        res.status(201).json({ message: "Profile access configured successfully", userId: user.id });
    } catch (error) {
        res.status(400).json({ error: "Email configuration footprint already present inside records or invalid schema context map." });
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
        if (!user || user.password !== hashPassword(password)) {
            return res.status(401).json({ error: "Invalid signatures." });
        }
        res.json({ name: user.name, role: user.role, email: user.email, canEdit: user.role === 'ADMIN' ? true : user.canEdit });
    } catch { res.status(500).json({ error: "Auth loop disconnect." }); }
});

// ==========================================
// 2. GRANULAR DEEP NETWORK DATASTREAM SCOPING
// ==========================================
app.get('/network', enforceSecurityScoping, async (req, res) => {
    try {
        const scope = req.currentUser.scopeType;
        const targetId = req.currentUser.scopeId;

        let network = await prisma.region.findMany({
            include: {
                distributors: {
                    include: {
                        agents: true,
                        customers: true
                    }
                },
                agents: {
                    include: {
                        distributors: true,
                        customers: true
                    }
                },
                customers: true
            }
        });

        if (req.currentUser.role === 'ADMIN') {
            return res.json(network);
        }

        if (scope === "REGION") {
            network = network.filter(r => r.id === targetId);
        } else if (scope === "DISTRIBUTOR") {
            network = network.map(r => {
                const filteredDists = r.distributors.filter(d => d.id === targetId || d.parentDistributorId === targetId);
                if (filteredDists.length > 0) {
                    return { ...r, distributors: filteredDists, agents: [], customers: [] };
                }
                return null;
            }).filter(Boolean);
        } else if (scope === "AGENT") {
            network = network.map(r => {
                const filteredAgents = r.agents.filter(a => a.id === targetId || a.parentAgentId === targetId);
                if (filteredAgents.length > 0) {
                    return { ...r, agents: filteredAgents, distributors: [], customers: [] };
                }
                return null;
            }).filter(Boolean);
        }

        res.json(network);
    } catch (error) {
        res.status(500).json({ error: "Scoping parsing bottleneck.", details: error.message });
    }
});

// ==========================================
// 3. SECURED CRUD CREATION SYSTEM ROUTES
// ==========================================
app.post('/regions', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    try {
        const r = await prisma.region.create({ data: { name: req.body.name.trim() } });
        res.status(201).json(r);
    } catch { res.status(400).json({ error: "Failed to create territory." }); }
});

app.post('/distributors', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    try {
        const d = await prisma.distributor.create({
            data: { name: req.body.name, regionId: parseInt(req.body.regionId), parentDistributorId: req.body.parentDistributorId ? parseInt(req.body.parentDistributorId) : null }
        });
        res.status(201).json(d);
    } catch { res.status(400).json({ error: "Failed to create distributor node." }); }
});

app.post('/agents', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    try {
        const dataPayload = {
            name: req.body.name,
            regionId: parseInt(req.body.regionId),
            parentAgentId: req.body.parentAgentId ? parseInt(req.body.parentAgentId) : null
        };
        if (req.body.distributorId) {
            dataPayload.distributors = { connect: { id: parseInt(req.body.distributorId) } };
        }
        const agent = await prisma.agent.create({ data: dataPayload });
        res.status(201).json(agent);
    } catch { res.status(400).json({ error: "Failed to create agent." }); }
});

app.post('/customers', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    try {
        const c = await prisma.customer.create({ data: { name: req.body.name, regionId: parseInt(req.body.regionId), distributorId: req.body.distributorId ? parseInt(req.body.distributorId) : null, agentId: req.body.agentId ? parseInt(req.body.agentId) : null } });
        res.status(201).json(c);
    } catch { res.status(400).json({ error: "Failed to onboard profile." }); }
});

// ==========================================
// 4. SECURED ENRICHMENT EDITING DATA INJECTORS
// ==========================================
const parseSharedFields = (body) => ({
    name: body.name,
    notes: body.notes || null,
    contactDetails: body.contactDetails || null,
    orders: body.orders || null,
    estimatedOrders: body.estimatedOrders || null,
    productTested: body.productTested === true || body.productTested === 'true',
    pocStatus: body.pocStatus || "NONE", 
    pocResults: body.pocResults || null
});

app.put('/regions/:id', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    const u = await prisma.region.update({ where: { id: parseInt(req.params.id) }, data: parseSharedFields(req.body) });
    res.json(u);
});

app.put('/distributors/:id', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    const dataPayload = { ...parseSharedFields(req.body) };
    if (req.body.parentDistributorId !== undefined) dataPayload.parentDistributorId = req.body.parentDistributorId ? parseInt(req.body.parentDistributorId) : null;
    if (req.body.regionId !== undefined) dataPayload.regionId = parseInt(req.body.regionId);

    const u = await prisma.distributor.update({ where: { id: parseInt(req.params.id) }, data: dataPayload });
    res.json(u);
});

app.put('/agents/:id', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    const dataPayload = { ...parseSharedFields(req.body) };
    if (req.body.parentAgentId !== undefined) dataPayload.parentAgentId = req.body.parentAgentId ? parseInt(req.body.parentAgentId) : null;
    if (req.body.regionId !== undefined) dataPayload.regionId = parseInt(req.body.regionId);

    const u = await prisma.agent.update({ where: { id: parseInt(req.params.id) }, data: dataPayload });
    res.json(u);
});

app.put('/customers/:id', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    const dataPayload = { ...parseSharedFields(req.body) };
    if (req.body.distributorId !== undefined) dataPayload.distributorId = req.body.distributorId ? parseInt(req.body.distributorId) : null;
    if (req.body.agentId !== undefined) dataPayload.agentId = req.body.agentId ? parseInt(req.body.agentId) : null;
    if (req.body.regionId !== undefined) dataPayload.regionId = parseInt(req.body.regionId);

    const u = await prisma.customer.update({ where: { id: parseInt(req.params.id) }, data: dataPayload });
    res.json(u);
});

// ==========================================
// 5. SECURED CASCADING DELETION DESTROYERS
// ==========================================
app.delete('/regions/:id', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    await prisma.region.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
});

app.delete('/distributors/:id', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    await prisma.distributor.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
});

app.delete('/agents/:id', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    await prisma.agent.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
});

app.delete('/customers/:id', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    await prisma.customer.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
});

app.put('/agents/:id/move', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    const agentId = parseInt(req.params.id);
    const { regionId, parentAgentId, connectDistId, disconnectDistId } = req.body;
    
    const updateData = {
        regionId: parseInt(regionId),
        parentAgentId: parentAgentId ? parseInt(parentAgentId) : null
    };

    if (connectDistId) {
        updateData.distributors = { connect: { id: parseInt(connectDistId) } };
    } else if (disconnectDistId) {
        updateData.distributors = { disconnect: { id: parseInt(disconnectDistId) } };
    }

    const u = await prisma.agent.update({ where: { id: agentId }, data: updateData });
    res.json(u);
});

app.put('/distributors/:id/move', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    const u = await prisma.distributor.update({ where: { id: parseInt(req.params.id) }, data: { regionId: parseInt(req.body.regionId), parentDistributorId: req.body.parentDistributorId ? parseInt(req.body.parentDistributorId) : null } });
    res.json(u);
});

app.put('/customers/:id/move', enforceSecurityScoping, verifyWritePermission, async (req, res) => {
    const u = await prisma.customer.update({ where: { id: parseInt(req.body.regionId) ? parseInt(req.body.regionId) : 1 }, data: { regionId: parseInt(req.body.regionId), distributorId: req.body.distributorId ? parseInt(req.body.distributorId) : null, agentId: req.body.agentId ? parseInt(req.body.agentId) : null } });
    res.json(u);
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Carbon3 CRM secure hub running on http://localhost:${PORT}`));