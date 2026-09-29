import sharp from '../server/node_modules/sharp/lib/index.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
mkdirSync('fixtures', { recursive: true });
const svg = `<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="1280" fill="#203235"/><circle cx="525" cy="290" r="165" fill="#cfb67e"/><path d="M0 670L310 360 720 830V1280H0Z" fill="#4e7270"/><path d="M0 920L420 570 720 840V1280H0Z" fill="#a4b7a5"/><path d="M300 1280L405 760 490 1280Z" fill="#d96646"/><text x="42" y="76" fill="#f4f0e4" font-family="sans-serif" font-size="24">STUDIO / MOCK FRAME</text><text x="42" y="1220" fill="#203235" font-family="sans-serif" font-size="22">LOCAL FIXTURE · NO MODEL CALL</text></svg>`;
await sharp(Buffer.from(svg)).png().toFile('fixtures/portrait.png');
execFileSync('ffmpeg', ['-y','-loglevel','error','-loop','1','-i','fixtures/portrait.png','-t','12','-vf','scale=360:640','-r','24','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','fixtures/clip.mp4']);
execFileSync('ffmpeg', ['-y','-loglevel','error','-f','lavfi','-i','sine=frequency=330:duration=12','-af','volume=0.1,afade=t=in:d=1,afade=t=out:st=11:d=1','fixtures/voice.wav']);
