import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Trophy, Zap, Lock, PlaySquare, Loader2 } from 'lucide-react';

declare global {
  interface Window {
    CrazyGames: any;
  }
}

class SoundManager {
  ctx: AudioContext | null = null;
  boostOsc: OscillatorNode | null = null;
  boostGain: GainNode | null = null;

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playOrbCollect() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playDeath() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.5);
    
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }

  playShieldBreak() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  setBoosting(isBoosting: boolean) {
    if (!this.ctx) return;
    if (isBoosting) {
      if (!this.boostOsc) {
        this.boostOsc = this.ctx.createOscillator();
        this.boostGain = this.ctx.createGain();
        this.boostOsc.type = 'sawtooth';
        this.boostOsc.frequency.setValueAtTime(60, this.ctx.currentTime);
        this.boostGain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        
        this.boostOsc.connect(this.boostGain);
        this.boostGain.connect(this.ctx.destination);
        this.boostOsc.start();
      }
    } else {
      if (this.boostOsc && this.boostGain) {
        this.boostGain.gain.setValueAtTime(this.boostGain.gain.value, this.ctx.currentTime);
        this.boostGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
        this.boostOsc.stop(this.ctx.currentTime + 0.1);
        this.boostOsc = null;
        this.boostGain = null;
      }
    }
  }
}

const soundManager = new SoundManager();

const COLORS = [
  { id: '#ff0055', name: 'Strawberry', free: true },
  { id: '#0088ff', name: 'Blueberry', free: true },
  { id: '#00ff88', name: 'Gooseberry', free: true },
  { id: '#ff00ff', name: 'Raspberry', free: false },
  { id: '#ffaa00', name: 'Goldenberry', free: false },
  { id: '#8800ff', name: 'Blackberry', free: false },
];

const PATTERNS = [
  { id: 'solid', name: 'Solid', free: true },
  { id: 'stripes', name: 'Stripes', free: true },
  { id: 'dots', name: 'Polka Dots', free: false },
  { id: 'core', name: 'Glowing Core', free: false },
];

interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  pattern: string;
  score: number;
  boost: number;
  isBoosting: boolean;
  trail: { x: number; y: number }[];
  radius: number;
  dead: boolean;
  isInvincible: boolean;
  hasInfiniteBoost: boolean;
  hasShield: boolean;
  spawnTime: number;
}

interface Orb {
  id: string;
  x: number;
  y: number;
  color: string;
}

interface PowerUp {
  id: string;
  x: number;
  y: number;
  type: 'invincibility' | 'speed' | 'shield';
}

interface GameState {
  players: Player[];
  orbs: Orb[];
  powerUps: PowerUp[];
  blackHoles: { id: string; x: number; y: number; radius: number }[];
  safeZone: number;
}

let screenShake = 0;
let currentZoom = 1;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [arenaSize, setArenaSize] = useState(3000);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [dead, setDead] = useState(false);
  const [leaderboard, setLeaderboard] = useState<Player[]>([]);
  const [killFeed, setKillFeed] = useState<{ id: number; killer: string; victim: string; isBounty: boolean }[]>([]);
  
  const [selectedColor, setSelectedColor] = useState(COLORS[0].id);
  const [selectedPattern, setSelectedPattern] = useState(PATTERNS[0].id);
  const [unlockedItems, setUnlockedItems] = useState<string[]>([]);
  const [isWatchingAd, setIsWatchingAd] = useState(false);

  const touchRef = useRef({
    joystickActive: false,
    base: { x: 0, y: 0 },
    stick: { x: 0, y: 0 },
    joyPointerId: null as number | null,
    boostActive: false,
    boostPointerId: null as number | null
  });
  const [joyUI, setJoyUI] = useState({ active: false, base: { x: 0, y: 0 }, stick: { x: 0, y: 0 } });

  const mouseRef = useRef({ x: 0, y: 0, isBoosting: false });
  const myPlayerRef = useRef<Player | null>(null);
  const prevScoreRef = useRef(0);
  const prevShieldRef = useRef(false);
  const prevBoostingRef = useRef(false);

  useEffect(() => {
    const initCG = async () => {
      if (window.CrazyGames) {
        try {
          await window.CrazyGames.SDK.game.sdkGameLoadingStart();
          await window.CrazyGames.SDK.game.sdkGameLoadingStop();
        } catch (e) {
          console.error("CrazyGames init error", e);
        }
      }
    };
    initCG();

    const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";
    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    newSocket.on('init', (data) => {
      setMyId(data.id);
      setArenaSize(data.arenaSize);
    });

    newSocket.on('state', (state: GameState) => {
      setGameState(state);
      const me = state.players.find(p => p.id === newSocket.id);
      if (me) {
        myPlayerRef.current = me;
        
        if (me.score > prevScoreRef.current) {
          soundManager.playOrbCollect();
        }
        prevScoreRef.current = me.score;

        if (prevShieldRef.current && !me.hasShield && !me.dead) {
          soundManager.playShieldBreak();
        }
        prevShieldRef.current = me.hasShield;

        if (me.isBoosting !== prevBoostingRef.current) {
          soundManager.setBoosting(me.isBoosting);
          prevBoostingRef.current = me.isBoosting;
        }
      }
      
      setLeaderboard([...state.players].sort((a, b) => b.score - a.score).slice(0, 5));
    });

    newSocket.on('died', () => {
      setDead(true);
      setJoined(false);
      soundManager.playDeath();
      soundManager.setBoosting(false);
      prevBoostingRef.current = false;
      screenShake = 30;
    });

    newSocket.on('killFeed', (data: { killer: string; victim: string; isBounty: boolean }) => {
      const id = Date.now() + Math.random();
      setKillFeed(prev => [...prev, { id, ...data }].slice(-5));
      setTimeout(() => {
        setKillFeed(prev => prev.filter(k => k.id !== id));
      }, 4000);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket || !joined || dead) return;

    const interval = setInterval(() => {
      if (myPlayerRef.current) {
        const me = myPlayerRef.current;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        
        let angle = 0;
        let isBoosting = false;

        if (touchRef.current.joystickActive) {
          angle = Math.atan2(touchRef.current.stick.y - touchRef.current.base.y, touchRef.current.stick.x - touchRef.current.base.x);
          isBoosting = touchRef.current.boostActive;
        } else {
          angle = Math.atan2(mouseRef.current.y - centerY, mouseRef.current.x - centerX);
          isBoosting = mouseRef.current.isBoosting;
        }

        socket.emit('input', { angle, isBoosting });
      }
    }, 1000 / 30);

    return () => clearInterval(interval);
  }, [socket, joined, dead]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      // Resize canvas
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!gameState) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const me = myPlayerRef.current;
      let camX = me ? me.x : arenaSize / 2;
      let camY = me ? me.y : arenaSize / 2;

      ctx.save();
      
      // Dynamic Zoom
      const targetZoom = me && me.isBoosting ? 0.75 : 1.0;
      currentZoom += (targetZoom - currentZoom) * 0.05;
      
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(currentZoom, currentZoom);
      
      // Screen Shake
      if (screenShake > 0.1) {
        ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
        screenShake *= 0.9;
      }
      
      ctx.translate(-camX, -camY);

      // Draw grid
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
      ctx.lineWidth = 2;
      const gridSize = 100;
      const startX = Math.floor((camX - canvas.width / 2 / currentZoom) / gridSize) * gridSize - gridSize;
      const startY = Math.floor((camY - canvas.height / 2 / currentZoom) / gridSize) * gridSize - gridSize;
      const endX = startX + canvas.width / currentZoom + gridSize * 2;
      const endY = startY + canvas.height / currentZoom + gridSize * 2;

      ctx.beginPath();
      for (let x = startX; x <= endX; x += gridSize) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
      }
      for (let y = startY; y <= endY; y += gridSize) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
      }
      ctx.stroke();

      // Draw Safe Zone
      const cx = arenaSize / 2;
      const cy = arenaSize / 2;
      const halfZone = (gameState.safeZone || arenaSize) / 2;
      
      ctx.strokeStyle = 'rgba(255, 0, 50, 0.8)';
      ctx.lineWidth = 5;
      ctx.shadowColor = 'red';
      ctx.shadowBlur = 20;
      ctx.strokeRect(cx - halfZone, cy - halfZone, halfZone * 2, halfZone * 2);
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
      ctx.fillRect(0, 0, arenaSize, cy - halfZone);
      ctx.fillRect(0, cy + halfZone, arenaSize, arenaSize - (cy + halfZone));
      ctx.fillRect(0, cy - halfZone, cx - halfZone, halfZone * 2);
      ctx.fillRect(cx + halfZone, cy - halfZone, arenaSize - (cx + halfZone), halfZone * 2);

      // Draw Black Holes
      gameState.blackHoles?.forEach(bh => {
        ctx.save();
        ctx.translate(bh.x, bh.y);
        ctx.rotate(Date.now() / 500);
        
        const grad = ctx.createRadialGradient(0, 0, bh.radius * 0.2, 0, 0, bh.radius * 2);
        grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
        grad.addColorStop(0.3, 'rgba(128, 0, 255, 0.8)');
        grad.addColorStop(1, 'rgba(128, 0, 255, 0)');
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, bh.radius * 2, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(0, 0, bh.radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Draw arena borders
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#ff00ff';
      ctx.shadowBlur = 20;
      ctx.strokeRect(0, 0, arenaSize, arenaSize);
      ctx.shadowBlur = 0;

      // Draw orbs
      gameState.orbs.forEach(orb => {
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = orb.color;
        ctx.shadowColor = orb.color;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Draw power-ups
      gameState.powerUps.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.beginPath();
        
        if (p.type === 'invincibility') {
          // Star
          ctx.fillStyle = '#fff';
          ctx.shadowColor = '#fff';
          for (let i = 0; i < 5; i++) {
            ctx.lineTo(Math.cos((18 + i * 72) * Math.PI / 180) * 12, -Math.sin((18 + i * 72) * Math.PI / 180) * 12);
            ctx.lineTo(Math.cos((54 + i * 72) * Math.PI / 180) * 5, -Math.sin((54 + i * 72) * Math.PI / 180) * 5);
          }
        } else if (p.type === 'speed') {
          // Diamond
          ctx.fillStyle = '#0ff';
          ctx.shadowColor = '#0ff';
          ctx.moveTo(0, -12);
          ctx.lineTo(10, 0);
          ctx.lineTo(0, 12);
          ctx.lineTo(-10, 0);
        } else if (p.type === 'shield') {
          // Hexagon
          ctx.fillStyle = '#0f0';
          ctx.shadowColor = '#0f0';
          for (let i = 0; i < 6; i++) {
            ctx.lineTo(10 * Math.cos(i * Math.PI / 3), 10 * Math.sin(i * Math.PI / 3));
          }
        }
        
        ctx.closePath();
        ctx.shadowBlur = 15;
        ctx.fill();
        ctx.restore();
      });

      // Draw trails (Tron style)
      gameState.players.forEach(player => {
        if (player.dead || player.trail.length < 2) return;
        
        ctx.beginPath();
        ctx.moveTo(player.trail[0].x, player.trail[0].y);
        for (let i = 1; i < player.trail.length; i++) {
          ctx.lineTo(player.trail[i].x, player.trail[i].y);
        }
        ctx.lineTo(player.x, player.y);
        
        // Outer glow (The "Wall" effect)
        ctx.strokeStyle = player.color;
        ctx.lineWidth = player.radius * 0.8;
        ctx.lineCap = 'square';
        ctx.lineJoin = 'miter';
        ctx.miterLimit = 2;
        ctx.shadowColor = player.color;
        ctx.shadowBlur = 20;
        ctx.stroke();
        
        // Inner core (The bright center of the light wall)
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = player.radius * 0.25;
        ctx.shadowBlur = 10;
        ctx.stroke();
        
        ctx.shadowBlur = 0;
      });

      // Draw players
      const topPlayerId = leaderboard[0]?.id;
      gameState.players.forEach(player => {
        if (player.dead) return;

        const timeSinceSpawn = Date.now() - player.spawnTime;
        const isSpawning = timeSinceSpawn < 1000;

        ctx.save();
        ctx.translate(player.x, player.y);

        // Draw spawn animation (under the ship)
        if (isSpawning) {
          const progress = timeSinceSpawn / 1000;
          const easeOut = 1 - Math.pow(1 - progress, 3);
          const ringRadius = player.radius * (5 - 4 * easeOut);
          
          ctx.save();
          ctx.rotate(progress * Math.PI * 2);
          
          // Outer collapsing hexagon
          ctx.beginPath();
          for(let i=0; i<6; i++) {
             const angle = i * Math.PI / 3;
             const px = Math.cos(angle) * ringRadius * 1.5;
             const py = Math.sin(angle) * ringRadius * 1.5;
             if(i===0) ctx.moveTo(px, py);
             else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.strokeStyle = player.color;
          ctx.lineWidth = 2 * (1 - progress);
          ctx.shadowColor = player.color;
          ctx.shadowBlur = 10;
          ctx.stroke();
          
          // Inner expanding/fading circle
          ctx.beginPath();
          ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${1 - progress})`;
          ctx.stroke();
          
          ctx.restore();
        }

        ctx.rotate(player.angle);

        // Scale ship up if just spawned
        if (timeSinceSpawn < 500) {
          const scale = timeSinceSpawn / 500;
          const elasticScale = scale + Math.sin(scale * Math.PI) * 0.2;
          ctx.scale(elasticScale, elasticScale);
        }

        // Ship body (triangle)
        ctx.beginPath();
        ctx.moveTo(player.radius, 0);
        ctx.lineTo(-player.radius, player.radius * 0.8);
        ctx.lineTo(-player.radius * 0.5, 0);
        ctx.lineTo(-player.radius, -player.radius * 0.8);
        ctx.closePath();

        ctx.fillStyle = '#111';
        ctx.fill();
        
        // Apply pattern
        ctx.save();
        ctx.clip();
        
        if (player.pattern === 'stripes') {
          ctx.fillStyle = player.color;
          ctx.globalAlpha = 0.5;
          for (let i = -player.radius; i < player.radius; i += 8) {
            ctx.fillRect(i, -player.radius, 4, player.radius * 2);
          }
        } else if (player.pattern === 'dots') {
          ctx.fillStyle = player.color;
          ctx.globalAlpha = 0.5;
          for (let i = -player.radius; i < player.radius; i += 10) {
            for (let j = -player.radius; j < player.radius; j += 10) {
              ctx.beginPath();
              ctx.arc(i, j, 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else if (player.pattern === 'core') {
          ctx.fillStyle = player.color;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.moveTo(player.radius * 0.5, 0);
          ctx.lineTo(-player.radius * 0.5, player.radius * 0.4);
          ctx.lineTo(-player.radius * 0.2, 0);
          ctx.lineTo(-player.radius * 0.5, -player.radius * 0.4);
          ctx.fill();
        }
        
        ctx.restore();

        ctx.strokeStyle = player.isInvincible && Date.now() % 200 < 100 ? '#fff' : player.color;
        ctx.lineWidth = 3;
        ctx.shadowColor = player.isInvincible ? '#fff' : player.color;
        ctx.shadowBlur = player.isBoosting || player.isInvincible ? 20 : 10;
        ctx.stroke();

        // Thruster (Improved Flame)
        if (player.isBoosting || player.hasInfiniteBoost) {
          const boostLength = player.radius * (1.5 + Math.random() * 1.5);
          const coreLength = boostLength * 0.6;
          
          // Outer flame
          ctx.beginPath();
          ctx.moveTo(-player.radius * 0.5, player.radius * 0.4);
          ctx.lineTo(-player.radius * 0.5 - boostLength, 0);
          ctx.lineTo(-player.radius * 0.5, -player.radius * 0.4);
          ctx.fillStyle = player.hasInfiniteBoost ? 'rgba(0, 255, 255, 0.8)' : 'rgba(255, 100, 0, 0.8)';
          ctx.shadowColor = player.hasInfiniteBoost ? '#0ff' : '#f90';
          ctx.shadowBlur = 20;
          ctx.fill();

          // Inner core
          ctx.beginPath();
          ctx.moveTo(-player.radius * 0.5, player.radius * 0.2);
          ctx.lineTo(-player.radius * 0.5 - coreLength, 0);
          ctx.lineTo(-player.radius * 0.5, -player.radius * 0.2);
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 10;
          ctx.fill();
        }

        // Shield
        if (player.hasShield) {
          ctx.beginPath();
          ctx.arc(0, 0, player.radius + 10, 0, Math.PI * 2);
          ctx.strokeStyle = '#0f0';
          ctx.lineWidth = 2;
          ctx.shadowColor = '#0f0';
          ctx.shadowBlur = 10;
          ctx.stroke();
        }

        ctx.restore();

        // Name tag
        let nameY = player.y - player.radius - 15;
        
        if (player.id === topPlayerId) {
          ctx.fillStyle = '#fbbf24';
          ctx.shadowColor = '#fbbf24';
          ctx.shadowBlur = 15;
          ctx.font = 'bold 14px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('👑 1ST', player.x, nameY - 15);
          ctx.shadowBlur = 0;
        }

        ctx.fillStyle = player.id === topPlayerId ? '#fbbf24' : 'rgba(255, 255, 255, 0.7)';
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, player.x, nameY);
      });

      // Draw 1st place indicator if off-screen
      const topPlayer = gameState.players.find(p => p.id === topPlayerId);
      if (topPlayer && topPlayer.id !== myId && !topPlayer.dead) {
        const screenX = topPlayer.x - camX + canvas.width / 2;
        const screenY = topPlayer.y - camY + canvas.height / 2;
        
        const padding = 50;
        const isOffScreen = screenX < padding || screenX > canvas.width - padding || 
                            screenY < padding || screenY > canvas.height - padding;
                            
        if (isOffScreen) {
          const angle = Math.atan2(topPlayer.y - camY, topPlayer.x - camX);
          const cx = canvas.width / 2;
          const cy = canvas.height / 2;
          const dx = screenX - cx;
          const dy = screenY - cy;
          const slope = dy / dx;
          
          let indX = screenX;
          let indY = screenY;
          
          const boundsX = cx - padding;
          const boundsY = cy - padding;
          
          if (Math.abs(dx) > boundsX || Math.abs(dy) > boundsY) {
            if (Math.abs(dx) / boundsX > Math.abs(dy) / boundsY) {
              indX = cx + Math.sign(dx) * boundsX;
              indY = cy + slope * Math.sign(dx) * boundsX;
            } else {
              indY = cy + Math.sign(dy) * boundsY;
              indX = cx + (Math.sign(dy) * boundsY) / slope;
            }
          }
          
          const worldX = indX - cx + camX;
          const worldY = indY - cy + camY;
          
          ctx.save();
          ctx.translate(worldX, worldY);
          ctx.rotate(angle);
          
          ctx.beginPath();
          ctx.moveTo(20, 0);
          ctx.lineTo(-10, 15);
          ctx.lineTo(-5, 0);
          ctx.lineTo(-10, -15);
          ctx.closePath();
          
          ctx.fillStyle = '#fbbf24';
          ctx.shadowColor = '#fbbf24';
          ctx.shadowBlur = 20;
          ctx.fill();
          
          ctx.rotate(-angle);
          ctx.font = '20px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('👑', 0, -25);
          
          ctx.restore();
        }
      }

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [gameState, arenaSize]);

  const watchAd = (itemToUnlock: string) => {
    setIsWatchingAd(true);
    
    if (window.CrazyGames) {
      const callbacks = {
        adFinished: () => {
          setUnlockedItems(prev => [...prev, itemToUnlock]);
          setIsWatchingAd(false);
        },
        adError: (error: any) => {
          console.error("Ad error", error);
          // Fallback if ad fails to load so player isn't stuck
          setUnlockedItems(prev => [...prev, itemToUnlock]);
          setIsWatchingAd(false);
        },
        adStarted: () => {
          // Mute audio while ad plays
          soundManager.setBoosting(false);
        }
      };
      window.CrazyGames.SDK.ad.requestAd('rewarded', callbacks);
    } else {
      // Fallback for local testing
      setTimeout(() => {
        setUnlockedItems(prev => [...prev, itemToUnlock]);
        setIsWatchingAd(false);
      }, 2000);
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    soundManager.init();
    
    const needsUnlockColor = !COLORS.find(c => c.id === selectedColor)?.free && !unlockedItems.includes(selectedColor);
    const needsUnlockPattern = !PATTERNS.find(p => p.id === selectedPattern)?.free && !unlockedItems.includes(selectedPattern);
    
    if (needsUnlockColor || needsUnlockPattern) {
      const itemToUnlock = needsUnlockColor ? selectedColor : selectedPattern;
      watchAd(itemToUnlock);
      return;
    }

    if (socket && name.trim()) {
      socket.emit('join', { name, color: selectedColor, pattern: selectedPattern });
      setJoined(true);
      setDead(false);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    
    const halfWidth = window.innerWidth / 2;
    if (e.clientX < halfWidth) {
      touchRef.current.joystickActive = true;
      touchRef.current.joyPointerId = e.pointerId;
      touchRef.current.base = { x: e.clientX, y: e.clientY };
      touchRef.current.stick = { x: e.clientX, y: e.clientY };
      setJoyUI({ active: true, base: { x: e.clientX, y: e.clientY }, stick: { x: e.clientX, y: e.clientY } });
    } else {
      touchRef.current.boostActive = true;
      touchRef.current.boostPointerId = e.pointerId;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;

    if (touchRef.current.joyPointerId === e.pointerId) {
      const dx = e.clientX - touchRef.current.base.x;
      const dy = e.clientY - touchRef.current.base.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = 50;
      
      let stickX = e.clientX;
      let stickY = e.clientY;
      
      if (dist > maxDist) {
        stickX = touchRef.current.base.x + (dx / dist) * maxDist;
        stickY = touchRef.current.base.y + (dy / dist) * maxDist;
      }
      
      touchRef.current.stick = { x: stickX, y: stickY };
      setJoyUI(prev => ({ ...prev, stick: { x: stickX, y: stickY } }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;

    if (touchRef.current.joyPointerId === e.pointerId) {
      touchRef.current.joystickActive = false;
      touchRef.current.joyPointerId = null;
      setJoyUI(prev => ({ ...prev, active: false }));
    }
    if (touchRef.current.boostPointerId === e.pointerId) {
      touchRef.current.boostActive = false;
      touchRef.current.boostPointerId = null;
    }
  };

  return (
    <div 
      className="relative w-screen h-screen overflow-hidden bg-[#0a0a0a] text-white font-sans selection:bg-fuchsia-500/30 touch-none"
      onMouseMove={(e) => {
        mouseRef.current.x = e.clientX;
        mouseRef.current.y = e.clientY;
      }}
      onMouseDown={() => mouseRef.current.isBoosting = true}
      onMouseUp={() => mouseRef.current.isBoosting = false}
      onMouseLeave={() => mouseRef.current.isBoosting = false}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block pointer-events-none" />

      {/* Touch Controls Overlay */}
      {joined && !dead && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          {joyUI.active && (
            <div className="absolute" style={{ left: joyUI.base.x - 50, top: joyUI.base.y - 50, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.3)' }}>
              <div className="absolute" style={{ left: 50 + (joyUI.stick.x - joyUI.base.x) - 25, top: 50 + (joyUI.stick.y - joyUI.base.y) - 25, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
            </div>
          )}
          <div className="absolute right-10 bottom-10 w-24 h-24 rounded-full border-2 border-white/20 bg-white/5 flex items-center justify-center">
            <span className="text-white/50 font-bold">BOOST</span>
          </div>
        </div>
      )}

      {/* UI Overlay */}
      {joined && !dead && myPlayerRef.current && (
        <>
          {/* Score HUD */}
          <div className="absolute top-6 left-6 flex flex-col pointer-events-none">
            <div className="text-cyan-400 text-xs font-black tracking-[0.2em] uppercase mb-1 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]">
              System Score
            </div>
            <div className="text-5xl font-black italic text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.5)]">
              {myPlayerRef.current.score.toString().padStart(5, '0')}
            </div>
          </div>

          {/* Leaderboard HUD */}
          <div className="absolute top-6 right-6 w-72 pointer-events-none">
            <div className="bg-black/40 backdrop-blur-md border-l-4 border-fuchsia-500 p-4 rounded-r-xl shadow-[0_0_20px_rgba(217,70,239,0.15)]">
              <div className="flex items-center gap-2 mb-4 text-fuchsia-400 font-black uppercase tracking-widest text-xs">
                <Trophy size={14} className="drop-shadow-[0_0_8px_rgba(217,70,239,0.8)]" /> 
                Top Programs
              </div>
              <div className="space-y-3">
                {leaderboard.map((p, i) => (
                  <div key={p.id} className="flex items-center justify-between text-sm relative">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <span className={`font-black italic ${i === 0 ? 'text-yellow-400' : 'text-white/40'}`}>
                        0{i + 1}
                      </span>
                      <span className={`truncate font-bold tracking-wide ${p.id === myId ? 'text-cyan-300 drop-shadow-[0_0_5px_rgba(103,232,249,0.8)]' : 'text-white/80'}`}>
                        {p.name}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-fuchsia-300">
                      {p.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Boost Meter HUD */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-96 pointer-events-none">
            <div className="flex justify-between items-end mb-2 px-1">
              <div className={`text-xs font-black tracking-[0.2em] uppercase flex items-center gap-2 ${myPlayerRef.current.hasInfiniteBoost ? 'text-cyan-300 drop-shadow-[0_0_8px_rgba(103,232,249,0.8)]' : 'text-white/70'}`}>
                <Zap size={14} className={myPlayerRef.current.isBoosting ? 'animate-pulse' : ''} /> 
                {myPlayerRef.current.hasInfiniteBoost ? 'OVERDRIVE ACTIVE' : 'Thruster Core'}
              </div>
              <div className="text-xs font-mono font-bold text-white/50">
                {myPlayerRef.current.hasInfiniteBoost ? 'INF' : `${Math.round(myPlayerRef.current.boost)}%`}
              </div>
            </div>
            
            {/* Segmented Boost Bar */}
            <div className="h-4 flex gap-1 p-1 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg skew-x-[-15deg]">
              {Array.from({ length: 20 }).map((_, i) => {
                const threshold = i * 5;
                const isActive = myPlayerRef.current!.hasInfiniteBoost || myPlayerRef.current!.boost > threshold;
                return (
                  <div 
                    key={i}
                    className={`flex-1 rounded-sm transition-all duration-75 ${
                      isActive 
                        ? myPlayerRef.current!.hasInfiniteBoost 
                          ? 'bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.8)]' 
                          : myPlayerRef.current!.isBoosting
                            ? 'bg-fuchsia-500 shadow-[0_0_10px_rgba(217,70,239,0.8)]'
                            : 'bg-white/80 shadow-[0_0_5px_rgba(255,255,255,0.5)]'
                        : 'bg-white/10'
                    }`}
                  />
                );
              })}
            </div>
            <div className="text-center text-white/30 text-[10px] uppercase tracking-widest mt-3 font-bold">
              [ Hold Click / Space to Engage ]
            </div>
          </div>
        </>
      )}

      {/* Join / Death Screen */}
      {(!joined || dead) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50">
          <div className="bg-[#111] border border-white/10 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center">
            <h1 className="text-5xl font-black italic tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-500 to-cyan-500">
              NEON-GRID
            </h1>
            <p className="text-white/50 mb-8">Collect orbs. Avoid trails. Survive.</p>
            
            {dead && (
              <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <div className="text-red-400 font-bold mb-1">YOU DIED</div>
                <div className="text-white/70 text-sm">Final Score: {myPlayerRef.current?.score || 0}</div>
              </div>
            )}

            <form onSubmit={handleJoin} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-bold text-white/50 uppercase tracking-wider mb-2">Pilot Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full bg-black border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-fuchsia-500 transition-colors"
                  maxLength={15}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-white/50 uppercase tracking-wider mb-2">Ship Color</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map(c => {
                    const isLocked = !c.free && !unlockedItems.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedColor(c.id)}
                        className={`relative w-10 h-10 rounded-full border-2 transition-all ${selectedColor === c.id ? 'border-white scale-110' : 'border-transparent opacity-70 hover:opacity-100'}`}
                        style={{ backgroundColor: c.id }}
                        title={c.name}
                      >
                        {isLocked && <Lock size={14} className="absolute inset-0 m-auto text-black/50 drop-shadow-md" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-white/50 uppercase tracking-wider mb-2">Ship Pattern</label>
                <div className="grid grid-cols-2 gap-2">
                  {PATTERNS.map(p => {
                    const isLocked = !p.free && !unlockedItems.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPattern(p.id)}
                        className={`relative flex items-center justify-center gap-2 py-2 px-3 rounded-lg border transition-all text-sm font-medium ${selectedPattern === p.id ? 'bg-white/10 border-white text-white' : 'bg-black border-white/20 text-white/70 hover:bg-white/5'}`}
                      >
                        {isLocked && <Lock size={14} className="text-fuchsia-400" />}
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-white text-black font-bold uppercase tracking-wider py-3 rounded-xl hover:bg-fuchsia-500 hover:text-white transition-colors flex items-center justify-center gap-2 mt-4"
              >
                {(!COLORS.find(c => c.id === selectedColor)?.free && !unlockedItems.includes(selectedColor)) || 
                 (!PATTERNS.find(p => p.id === selectedPattern)?.free && !unlockedItems.includes(selectedPattern)) ? (
                  <><PlaySquare size={18} /> Watch Ad to Unlock</>
                ) : (
                  dead ? 'Play Again' : 'Enter Arena'
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Mock Ad Overlay */}
      {isWatchingAd && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/95 text-white">
          <Loader2 size={48} className="animate-spin text-fuchsia-500 mb-6" />
          <h2 className="text-2xl font-bold mb-2">Watching Ad...</h2>
          <p className="text-white/50 text-center max-w-sm">
            Thank you for supporting the server! Your customization item will be unlocked in a few seconds.
          </p>
        </div>
      )}
    </div>
  );
}
