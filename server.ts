import express from "express";
import { createServer as createViteServer } from "vite";
import http from "http";
import { Server } from "socket.io";
import path from "path";

const PORT = 3000;
const ARENA_SIZE = 3000;
const MAX_ORBS = 300;
const MAX_POWERUPS = 15;
const POWERUP_RADIUS = 15;
const BASE_SPEED = 200; // units per second
const BOOST_SPEED = 400;
const BOOST_DRAIN_RATE = 30; // boost per second
const BOOST_REGEN_RATE = 5; // boost per second
const MAX_BOOST = 100;
const TRAIL_LIFETIME = 3000; // ms

interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  targetAngle: number;
  color: string;
  pattern: string;
  score: number;
  boost: number;
  isBoosting: boolean;
  trail: { x: number; y: number; time: number }[];
  radius: number;
  dead: boolean;
  invincibleUntil: number;
  infiniteBoostUntil: number;
  hasShield: boolean;
  isBot?: boolean;
  respawnTime?: number;
  spawnTime: number;
}

interface Orb {
  id: string;
  x: number;
  y: number;
  color: string;
  value: number;
}

interface PowerUp {
  id: string;
  x: number;
  y: number;
  type: 'invincibility' | 'speed' | 'shield';
}

interface BlackHole {
  id: string;
  x: number;
  y: number;
  radius: number;
  mass: number;
}

const state = {
  players: new Map<string, Player>(),
  orbs: new Map<string, Orb>(),
  powerUps: new Map<string, PowerUp>(),
  blackHoles: new Map<string, BlackHole>(),
};

const colors = [
  "#ff00ff", // Neon Purple
  "#00ffff", // Cyan
  "#ff0055", // Pink
  "#00ff88", // Neon Green
  "#ffff00", // Yellow
  "#ffaa00", // Orange
];

function spawnOrb(x?: number, y?: number, value = 10) {
  const id = Math.random().toString(36).substring(2, 9);
  state.orbs.set(id, {
    id,
    x: x ?? Math.random() * ARENA_SIZE,
    y: y ?? Math.random() * ARENA_SIZE,
    color: colors[Math.floor(Math.random() * colors.length)],
    value,
  });
}

function spawnPowerUp() {
  const id = Math.random().toString(36).substring(2, 9);
  const types: ('invincibility' | 'speed' | 'shield')[] = ['invincibility', 'speed', 'shield'];
  state.powerUps.set(id, {
    id,
    x: Math.random() * ARENA_SIZE,
    y: Math.random() * ARENA_SIZE,
    type: types[Math.floor(Math.random() * types.length)],
  });
}

// Initial orbs
for (let i = 0; i < MAX_ORBS; i++) {
  spawnOrb();
}
for (let i = 0; i < MAX_POWERUPS; i++) {
  spawnPowerUp();
}

for (let i = 0; i < 3; i++) {
  const id = `bh_${i}`;
  state.blackHoles.set(id, {
    id,
    x: ARENA_SIZE * 0.2 + Math.random() * ARENA_SIZE * 0.6,
    y: ARENA_SIZE * 0.2 + Math.random() * ARENA_SIZE * 0.6,
    radius: 80,
    mass: 200000
  });
}

let botIndex = 0;
const BOT_NAMES = ["Shadow", "Vortex", "Neon", "Pulse", "Cyber", "Glitch", "Nova", "Zero", "Echo", "Flux"];

function spawnBot() {
  const id = `bot_${Math.random().toString(36).substring(2, 9)}`;
  state.players.set(id, {
    id,
    name: BOT_NAMES[botIndex % BOT_NAMES.length],
    x: Math.random() * ARENA_SIZE,
    y: Math.random() * ARENA_SIZE,
    vx: 0,
    vy: 0,
    angle: Math.random() * Math.PI * 2,
    targetAngle: 0,
    color: colors[botIndex % colors.length],
    pattern: 'core',
    score: 50,
    boost: MAX_BOOST,
    isBoosting: false,
    trail: [],
    radius: 15,
    dead: false,
    invincibleUntil: 0,
    infiniteBoostUntil: 0,
    hasShield: false,
    isBot: true,
    respawnTime: 0,
    spawnTime: Date.now()
  });
  botIndex++;
}

function balanceBots() {
  const players = Array.from(state.players.values());
  const realPlayers = players.filter(p => !p.isBot).length;
  const bots = players.filter(p => p.isBot);
  
  const targetBots = Math.max(0, 5 - realPlayers);
  
  if (bots.length > targetBots) {
    const botsToRemove = bots.length - targetBots;
    for (let i = 0; i < botsToRemove; i++) {
      state.players.delete(bots[i].id);
    }
  } else if (bots.length < targetBots) {
    const botsToAdd = targetBots - bots.length;
    for (let i = 0; i < botsToAdd; i++) {
      spawnBot();
    }
  }
}

balanceBots();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    socket.on("join", (data: { name: string, color: string, pattern: string }) => {
      state.players.set(socket.id, {
        id: socket.id,
        name: data.name.substring(0, 15) || "Guest",
        x: Math.random() * ARENA_SIZE,
        y: Math.random() * ARENA_SIZE,
        vx: 0,
        vy: 0,
        angle: Math.random() * Math.PI * 2,
        targetAngle: 0,
        color: data.color || '#ff0055',
        pattern: data.pattern || 'solid',
        score: 0,
        boost: MAX_BOOST,
        isBoosting: false,
        trail: [],
        radius: 15,
        dead: false,
        invincibleUntil: 0,
        infiniteBoostUntil: 0,
        hasShield: false,
        spawnTime: Date.now()
      });
      balanceBots();
      socket.emit("init", { id: socket.id, arenaSize: ARENA_SIZE });
    });

    socket.on("input", (data: { angle: number; isBoosting: boolean }) => {
      const player = state.players.get(socket.id);
      if (player && !player.dead) {
        player.targetAngle = data.angle;
        player.isBoosting = data.isBoosting && player.boost > 0;
      }
    });

    socket.on("disconnect", () => {
      console.log("Player disconnected:", socket.id);
      state.players.delete(socket.id);
      balanceBots();
    });
  });

  let lastTime = Date.now();
  let matchStartTime = Date.now();
  const SHRINK_START = 5 * 60 * 1000; // 5 mins
  const SHRINK_END = 8 * 60 * 1000; // 8 mins
  const MIN_ZONE = 1000;

  setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    const elapsed = now - matchStartTime;
    let safeZone = ARENA_SIZE;
    if (elapsed > SHRINK_START) {
      const progress = Math.min(1, (elapsed - SHRINK_START) / (SHRINK_END - SHRINK_START));
      safeZone = ARENA_SIZE - progress * (ARENA_SIZE - MIN_ZONE);
    }

    if (safeZone === MIN_ZONE) {
      const aliveRealPlayers = Array.from(state.players.values()).filter(p => !p.isBot && !p.dead).length;
      if (aliveRealPlayers <= 1) {
        matchStartTime = now;
      }
    }

    // Update players
    for (const [id, player] of state.players.entries()) {
      if (player.dead) {
        if (player.isBot) {
          if (!player.respawnTime) {
            player.respawnTime = now + 3000;
          } else if (now > player.respawnTime) {
            player.dead = false;
            player.x = Math.random() * ARENA_SIZE;
            player.y = Math.random() * ARENA_SIZE;
            player.score = 50;
            player.radius = 15;
            player.trail = [];
            player.boost = MAX_BOOST;
            player.respawnTime = 0;
            player.invincibleUntil = now + 2000;
            player.spawnTime = now;
          }
        }
        continue;
      }

      if (player.isBot) {
        let nearestOrb = null;
        let minOrbDist = Infinity;
        for (const orb of state.orbs.values()) {
          const dist = Math.hypot(player.x - orb.x, player.y - orb.y);
          if (dist < minOrbDist) {
            minOrbDist = dist;
            nearestOrb = orb;
          }
        }

        let nearestPowerUp = null;
        let minPowerUpDist = Infinity;
        for (const p of state.powerUps.values()) {
          const dist = Math.hypot(player.x - p.x, player.y - p.y);
          if (dist < minPowerUpDist) {
            minPowerUpDist = dist;
            nearestPowerUp = p;
          }
        }

        let targetX = player.x;
        let targetY = player.y;
        
        if (nearestPowerUp && minPowerUpDist < 500) {
           targetX = nearestPowerUp.x;
           targetY = nearestPowerUp.y;
        } else if (nearestOrb) {
           targetX = nearestOrb.x;
           targetY = nearestOrb.y;
        }

        const wallMargin = 200;
        if (player.x < wallMargin) targetX = ARENA_SIZE / 2;
        if (player.x > ARENA_SIZE - wallMargin) targetX = ARENA_SIZE / 2;
        if (player.y < wallMargin) targetY = ARENA_SIZE / 2;
        if (player.y > ARENA_SIZE - wallMargin) targetY = ARENA_SIZE / 2;

        player.targetAngle = Math.atan2(targetY - player.y, targetX - player.x);
        player.isBoosting = (minOrbDist > 300 || minPowerUpDist < 300) && player.boost > 30;
      }

      // Turn towards target angle
      let diff = player.targetAngle - player.angle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      
      const turnSpeed = Math.PI * 3; // rad per sec
      if (Math.abs(diff) < turnSpeed * dt) {
        player.angle = player.targetAngle;
      } else {
        player.angle += Math.sign(diff) * turnSpeed * dt;
      }

      // Boost logic
      const hasInfiniteBoost = player.infiniteBoostUntil > now;
      if (player.isBoosting && (player.boost > 0 || hasInfiniteBoost)) {
        if (!hasInfiniteBoost) {
          player.boost -= BOOST_DRAIN_RATE * dt;
          if (player.boost <= 0) {
            player.boost = 0;
            player.isBoosting = false;
          }
        }
      } else {
        player.boost = Math.min(MAX_BOOST, player.boost + BOOST_REGEN_RATE * dt);
      }

      const speed = player.isBoosting ? BOOST_SPEED : BASE_SPEED;
      player.vx = Math.cos(player.angle) * speed;
      player.vy = Math.sin(player.angle) * speed;

      player.x += player.vx * dt;
      player.y += player.vy * dt;

      // Black Hole Gravity
      for (const bh of state.blackHoles.values()) {
        const dx = bh.x - player.x;
        const dy = bh.y - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 800 && dist > 10) {
          const force = bh.mass / (dist * dist);
          player.x += (dx / dist) * force * dt;
          player.y += (dy / dist) * force * dt;
        }
        if (dist < bh.radius * 0.4 && !player.dead && player.invincibleUntil < now) {
          player.dead = true;
          io.emit("killFeed", { killer: "Black Hole", victim: player.name, isBounty: false });
          io.to(player.id).emit("died");
        }
      }

      // Safe Zone Damage
      const halfZone = safeZone / 2;
      const cx = ARENA_SIZE / 2;
      const cy = ARENA_SIZE / 2;
      if (Math.abs(player.x - cx) > halfZone || Math.abs(player.y - cy) > halfZone) {
        if (!player.dead && player.invincibleUntil < now) {
          player.boost -= 100 * dt;
          if (player.boost <= 0) {
            player.dead = true;
            io.emit("killFeed", { killer: "The Grid", victim: player.name, isBounty: false });
            io.to(player.id).emit("died");
          }
        }
      }

      // Bounds check
      player.x = Math.max(player.radius, Math.min(ARENA_SIZE - player.radius, player.x));
      player.y = Math.max(player.radius, Math.min(ARENA_SIZE - player.radius, player.y));

      // Add trail point
      if (player.trail.length === 0 || 
          Math.hypot(player.trail[player.trail.length - 1].x - player.x, 
                     player.trail[player.trail.length - 1].y - player.y) > 20) {
        player.trail.push({ x: player.x, y: player.y, time: now });
      }

      // Remove old trail points
      const trailLength = Math.max(1000, Math.min(TRAIL_LIFETIME, 1000 + player.score * 10));
      while (player.trail.length > 0 && now - player.trail[0].time > trailLength) {
        player.trail.shift();
      }

      // Check orb collisions
      for (const [orbId, orb] of state.orbs.entries()) {
        const dist = Math.hypot(player.x - orb.x, player.y - orb.y);
        if (dist < player.radius + 10) {
          player.score += orb.value;
          player.boost = Math.min(MAX_BOOST, player.boost + orb.value);
          player.radius = 15 + Math.sqrt(player.score);
          state.orbs.delete(orbId);
        }
      }

      // Check power-up collisions
      for (const [pId, p] of state.powerUps.entries()) {
        const dist = Math.hypot(player.x - p.x, player.y - p.y);
        if (dist < player.radius + POWERUP_RADIUS) {
          if (p.type === 'invincibility') player.invincibleUntil = now + 5000;
          if (p.type === 'speed') player.infiniteBoostUntil = now + 5000;
          if (p.type === 'shield') player.hasShield = true;
          state.powerUps.delete(pId);
        }
      }
    }

    // Check player collisions (head to trail)
    for (const [id1, p1] of state.players.entries()) {
      if (p1.dead) continue;
      const isInvincible = p1.invincibleUntil > now;
      if (isInvincible) continue; // Skip death check for p1

      for (const [id2, p2] of state.players.entries()) {
        if (id1 === id2 || p2.dead) continue;
        
        // Check p1 head against p2 trail
        for (let i = 0; i < p2.trail.length - 1; i++) {
          const t1 = p2.trail[i];
          const t2 = p2.trail[i+1];
          
          // Line segment to point distance
          const l2 = Math.pow(t1.x - t2.x, 2) + Math.pow(t1.y - t2.y, 2);
          let t = 0;
          if (l2 !== 0) {
            t = Math.max(0, Math.min(1, ((p1.x - t1.x) * (t2.x - t1.x) + (p1.y - t1.y) * (t2.y - t1.y)) / l2));
          }
          const projX = t1.x + t * (t2.x - t1.x);
          const projY = t1.y + t * (t2.y - t1.y);
          const dist = Math.hypot(p1.x - projX, p1.y - projY);

          if (dist < p1.radius + 5) {
            if (p1.hasShield) {
              p1.hasShield = false;
              p1.invincibleUntil = now + 1000; // 1 sec invincibility to escape
              break; // survived this frame
            }

            // p1 died
            p1.dead = true;
            
            const isBounty = p1.score > 1000 && p1.id === Array.from(state.players.values()).sort((a,b)=>b.score-a.score)[0]?.id;
            if (isBounty) p2.score += 500;
            
            p2.score += Math.floor(p1.score / 2);
            p2.radius = 15 + Math.sqrt(p2.score);
            
            io.emit("killFeed", { killer: p2.name, victim: p1.name, isBounty });
            
            // Spawn orbs from dead player
            const numOrbs = Math.min(50, Math.floor(p1.score / 10) + 5);
            for (let j = 0; j < numOrbs; j++) {
              spawnOrb(
                p1.x + (Math.random() - 0.5) * 100,
                p1.y + (Math.random() - 0.5) * 100,
                10
              );
            }
            io.to(id1).emit("died");
            break;
          }
        }
      }
    }

    // Respawn orbs
    while (state.orbs.size < MAX_ORBS) {
      spawnOrb();
    }

    // Respawn powerups
    if (Math.random() < 0.02 && state.powerUps.size < MAX_POWERUPS) {
      spawnPowerUp();
    }

    // Broadcast state
    const pack = {
      players: Array.from(state.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        x: Math.round(p.x),
        y: Math.round(p.y),
        angle: p.angle,
        color: p.color,
        pattern: p.pattern,
        score: p.score,
        boost: Math.round(p.boost),
        isBoosting: p.isBoosting,
        trail: p.trail.map(t => ({ x: Math.round(t.x), y: Math.round(t.y) })),
        radius: Math.round(p.radius),
        dead: p.dead,
        isInvincible: p.invincibleUntil > now,
        hasInfiniteBoost: p.infiniteBoostUntil > now,
        hasShield: p.hasShield,
        spawnTime: p.spawnTime
      })),
      orbs: Array.from(state.orbs.values()).map(o => ({
        id: o.id,
        x: Math.round(o.x),
        y: Math.round(o.y),
        color: o.color
      })),
      powerUps: Array.from(state.powerUps.values()).map(p => ({
        id: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        type: p.type
      })),
      blackHoles: Array.from(state.blackHoles.values()).map(bh => ({
        id: bh.id,
        x: Math.round(bh.x),
        y: Math.round(bh.y),
        radius: Math.round(bh.radius)
      })),
      safeZone: Math.round(safeZone)
    };

    io.emit("state", pack);

  }, 1000 / 30); // 30 TPS

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
