// Generates vDAA zone scenes on Mr. Tang's ComfyUI (Windows PC on the LAN). Zero dependencies (Node 24 fetch/FormData).
//
//   node tools/comfy-gen.mjs --info                       what the server has: checkpoints, ControlNets, samplers
//   node tools/comfy-gen.mjs agora [--seed 42] [--n 2]     render one zone from design/scenes.json
//   node tools/comfy-gen.mjs all                           render every zone
//   node tools/comfy-gen.mjs mascot [--n 4]                the DAA Wolf, FLUX Kontext from design/refs/mascot.jpg
//   node tools/comfy-gen.mjs art <name> --prompt "..."     a lesson picture in the clay-toy look (FLUX text-to-image), to design/art/<name>-<seed>.png
//
// COMFY_URL (default https://localhost:8443, the ComfyStudio gateway on the PC). Outputs go to design/scenes/<zone>-<seed>.png.
// The gateway wants HTTP Basic auth (any username + the LAN password). The password comes from the macOS Keychain item
// "vdaa-comfystudio" (or COMFY_PASSWORD) and is never printed or written anywhere. TLS trusts only the gateway's own
// self-signed certificate, pinned in design/comfystudio.pem.
// A zone may name a structure reference photo ("ref": "design/refs/agora.jpg"): it is uploaded and fed through a
// ControlNet (depth or canny, whichever the server has) so the scene keeps DAA's real architecture. Reference photos
// stay on the LAN; never put photos with people in design/refs/.
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';

const URL0 = (process.env.COMFY_URL || 'https://localhost:8443').replace(/\/$/, '');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'design', 'scenes');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const PEM = path.join(ROOT, 'design', 'comfystudio.pem');
if (URL0.startsWith('https:') && fs.existsSync(PEM)) tls.setDefaultCACertificates([fs.readFileSync(PEM, 'utf8')]);
function password() {
  if (process.env.COMFY_PASSWORD) return process.env.COMFY_PASSWORD;
  try { return execFileSync('security', ['find-generic-password', '-s', 'vdaa-comfystudio', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
const PW = URL0.startsWith('https:') ? password() : null;
if (URL0.startsWith('https:') && !PW) { console.error('No gateway password. Store it once with:\n  security add-generic-password -a comfy -s vdaa-comfystudio -w'); process.exit(1); }
const AUTH = PW ? { authorization: 'Basic ' + Buffer.from('vdaa:' + PW).toString('base64') } : {};

// The gateway answers a good login with a session cookie + 303 back to the same URL; fetch has no cookie jar, so keep it here.
let COOKIE = '';
const api = async (p, opts = {}) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(URL0 + p, { ...opts, redirect: 'manual', headers: { ...opts.headers, ...AUTH, ...(COOKIE && { cookie: COOKIE }) } });
    const sc = r.headers.get('set-cookie'); if (sc) COOKIE = sc.split(';')[0];
    if (r.status === 303 && sc) continue;
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status} ${await r.text().catch(() => '')}`.slice(0, 400));
    return r;
  }
  throw new Error(`${p}: the gateway kept redirecting (login not accepted?)`);
};
const json = async (p, opts) => (await api(p, opts)).json();

async function info() {
  const oi = await json('/object_info');
  // Combo inputs come as [[...options]] or, in newer ComfyUI, ['COMBO', {options}].
  const opts = (node, input) => { const v = oi[node]?.input?.required?.[input]; return Array.isArray(v?.[0]) ? v[0] : v?.[1]?.options || []; };
  return {
    checkpoints: opts('CheckpointLoaderSimple', 'ckpt_name'),
    unets: opts('UNETLoader', 'unet_name'),
    clips: opts('DualCLIPLoader', 'clip_name1'),
    vaes: opts('VAELoader', 'vae_name'),
    controlnets: opts('ControlNetLoader', 'control_net_name'),
    samplers: opts('KSampler', 'sampler_name'),
    schedulers: opts('KSampler', 'scheduler'),
    preprocessors: Object.keys(oi).filter(k => /depth|canny|lineart/i.test(k)).slice(0, 20),
  };
}

const pick = (list, prefs) => { for (const re of prefs) { const m = list.find(x => re.test(x)); if (m) return m; } return list[0]; };

async function upload(file) {
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(file)]), path.basename(file));
  fd.append('overwrite', 'true');
  return (await json('/upload/image', { method: 'POST', body: fd })).name;
}

// An SDXL-style text-to-image graph, with an optional ControlNet branch fed by a reference photo.
function graph({ ckpt, prompt, negative, seed, w, h, steps, cfg, sampler, scheduler, cn, refName, cnStrength, preproc }) {
  const g = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    5: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'vdaa' } },
  };
  if (cn && refName) {
    g[10] = { class_type: 'LoadImage', inputs: { image: refName } };
    g[11] = { class_type: 'ControlNetLoader', inputs: { control_net_name: cn } };
    let hint = ['10', 0];
    if (preproc) { g[12] = { class_type: preproc, inputs: { image: ['10', 0] } }; hint = ['12', 0]; }
    g[13] = { class_type: 'ControlNetApplyAdvanced', inputs: { positive: ['2', 0], negative: ['3', 0], control_net: ['11', 0], image: hint, strength: cnStrength, start_percent: 0, end_percent: 0.8, vae: ['1', 2] } };
    g[5].inputs.positive = ['13', 0]; g[5].inputs.negative = ['13', 1];
  }
  return g;
}

async function render(zone, z0, inf, seed) {
  // --ref swaps the structure photo, e.g. a picked night render so its day twin keeps the same composition.
  const z = { ...z0, ref: flag('--ref', z0.ref), strength: +flag('--strength', z0.strength ?? 0.55) };
  const ckpt = flag('--ckpt', z.ckpt) || pick(inf.checkpoints, [/juggernaut/i, /realvis/i, /sdxl/i, /xl/i]);
  if (!ckpt) throw new Error('no checkpoint found on the server (run --info)');
  // SDXL ControlNets only (a FLUX one won't load against an SDXL checkpoint); a union model is driven with a depth map.
  const cn = z.ref ? pick(inf.controlnets.filter(x => !/flux|openpose/i.test(x)), [/depth/i, /union/i, /canny/i]) : null;
  const preproc = cn && /depth|union/i.test(cn) ? pick(inf.preprocessors, [/^DepthAnythingV2Preprocessor$/, /DepthAnything|MiDaS|Zoe/i]) : cn && /canny/i.test(cn) ? 'Canny' : null;
  const refName = z.ref && cn ? await upload(path.resolve(ROOT, z.ref)) : null;
  const g = graph({ ckpt, prompt: `${z.prompt}, ${LIGHT[TIME]}, ${STYLE}`, negative: `${NEGATIVE}, ${LIGHT_NEG[TIME]}`, seed, w: 1344, h: 768, steps: +flag('--steps', 30), cfg: +flag('--cfg', 5.5),
    sampler: pick(inf.samplers, [/dpmpp_2m$/, /euler/]), scheduler: pick(inf.schedulers, [/karras/, /normal/]), cn, refName, cnStrength: z.strength ?? 0.55, preproc });
  if (preproc && !/Canny/.test(preproc)) g[12].inputs = { image: ['10', 0], resolution: 1024 };
  if (preproc === 'Canny') g[12].inputs = { image: ['10', 0], low_threshold: 0.4, high_threshold: 0.8 };
  if (cn && /union/i.test(cn)) { g[14] = { class_type: 'SetUnionControlNetType', inputs: { control_net: ['11', 0], type: 'depth' } }; g[13].inputs.control_net = ['14', 0]; }
  process.stdout.write(`${zone} seed ${seed}: queued (${ckpt}${cn ? ` + ${cn}` : ''})`);
  return run(g, zone, path.join(OUT, `${zone}${TIME === 'day' ? '-day' : ''}-${seed}.png`));
}

// Queue a graph, wait for it, save its first image to `file`.
async function run(g, label, file) {
  const { prompt_id } = await json('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: g, client_id: 'vdaa' }) });
  for (let t = 0; t < 600; t++) {
    await new Promise(r => setTimeout(r, 2000));
    const h = (await json(`/history/${prompt_id}`))[prompt_id];
    if (!h) { if (t % 5 === 0) process.stdout.write('.'); continue; }
    if (h.status?.status_str === 'error') {
      const err = (h.status.messages || []).find((m) => m[0] === 'execution_error')?.[1];
      throw new Error(`${label}: ComfyUI error in ${err?.node_type ?? '?'} (node ${err?.node_id ?? '?'}): ${err?.exception_message ?? JSON.stringify(h.status.messages).slice(0, 1500)}`);
    }
    const img = Object.values(h.outputs || {}).flatMap(o => o.images || [])[0];
    if (!img) throw new Error(`${label}: finished without an image`);
    const buf = Buffer.from(await (await api(`/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`)).arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf);
    console.log(` saved ${path.relative(ROOT, file)}`); return file;
  }
  throw new Error(`${label}: timed out`);
}

// The DAA Wolf: FLUX.1 Kontext redraws the school-mascot photo (design/refs/mascot.jpg, cropped to the costume, no
// people) as an original illustrated character. Kontext edits the reference instead of inventing a new wolf.
const MASCOT = 'Redraw this costumed school mascot as an original polished 2D game mascot illustration: a friendly cartoon wolf with royal blue and white fur, bright ice-blue eyes, a confident open-mouth grin, arms crossed, wearing a plain white sports jersey with light-blue shoulder stripes and no lettering. Keep the same face, colours and pose. Clean bold outlines, soft cel shading, full upper body, centred on a plain white background. No text, no people, no costume seams.';
async function mascot(inf, seed) {
  const unet = inf.unets.find(u => /kontext/i.test(u));
  if (!unet) throw new Error('no FLUX Kontext model on the server (run --info)');
  // Anchor the CLIP-L match: EVA02_CLIP_L_336... (PuLID's face encoder) lives in the same folder and also matches /clip_l/i.
  const clip1 = pick(inf.clips, [/^clip_l\.safetensors$/i, /^clip_l/i]), clip2 = pick(inf.clips, [/^t5xxl.*fp8/i, /^t5xxl/i]), vae = pick(inf.vaes, [/^ae\./i, /flux/i]);
  if (!/^clip_l/i.test(clip1) || !/^t5xxl/i.test(clip2)) throw new Error(`FLUX text encoders not found (got ${clip1}, ${clip2})`);
  // FLUX + T5 need the GPU to themselves; SDXL scene models left resident make the text encoder load as empty "meta" tensors.
  await api('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
  await new Promise((r) => setTimeout(r, 3000));
  const refName = await upload(path.resolve(ROOT, flag('--ref', 'design/refs/mascot.jpg')));
  const g = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },   // matches ComfyStudio/09_flux_kontext_identity.json on the PC
    2: { class_type: 'DualCLIPLoader', inputs: { clip_name1: clip1, clip_name2: flag('--clip2', clip2), type: 'flux', device: flag('--clip-device', 'default') } },
    3: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    4: { class_type: 'LoadImage', inputs: { image: refName } },
    5: { class_type: 'FluxKontextImageScale', inputs: { image: ['4', 0] } },
    6: { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['3', 0] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: flag('--prompt', MASCOT), clip: ['2', 0] } },
    8: { class_type: 'ReferenceLatent', inputs: { conditioning: ['7', 0], latent: ['6', 0] } },
    9: { class_type: 'FluxGuidance', inputs: { conditioning: ['8', 0], guidance: +flag('--guidance', 2.5) } },
    10: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['7', 0] } },
    11: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['9', 0], negative: ['10', 0], latent_image: ['6', 0], seed, steps: +flag('--steps', 24), cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    12: { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    13: { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'vdaa-mascot' } },
  };
  process.stdout.write(`mascot seed ${seed}: queued (${unet} + ${clip1} + ${flag('--clip2', clip2)})`);
  return run(g, 'mascot', path.join(ROOT, 'design', 'mascot', `wolf-${seed}.png`));
}

// Lesson pictures (the Learning Road): one fixed look so every card matches. Mr. Tang chose this on 2026-11-09: a painted
// hero-shooter splash-art look (angular shapes, flat colour blocks, paint slashes) in the DAA blues with a coral accent.
// Never text or numbers in a picture: anything a student must read is real HTML beside it. Render two tries and pick.
// FLUX has no negative prompt: writing "no currency signs, no numbers" made it scatter $ and £ marks, so the style only says what to draw.
const ART_STYLE = 'stylized hand-painted game concept art, angular geometric shapes with sharp faceted planes, flat colour blocks with hard-edged cel shading, visible confident brush strokes, bold graphic silhouettes, strong rim lighting, dramatic diagonal composition, a background of large plain angular colour shards and broad paint slashes, limited palette of deep navy, royal blue, ice blue, off-white and a hot coral red accent with small touches of gold, crisp, high contrast, every surface smooth, blank and unmarked, clean uncluttered empty background';
async function art(inf, name, seed) {
  const unet = flag('--unet') || inf.unets.find(u => /krea/i.test(u)) || inf.unets.find(u => /flux/i.test(u) && !/kontext/i.test(u));
  if (!unet) throw new Error('no FLUX text-to-image model on the server (run --info)');
  const clip1 = pick(inf.clips, [/^clip_l\.safetensors$/i, /^clip_l/i]), clip2 = pick(inf.clips, [/^t5xxl.*fp8/i, /^t5xxl/i]), vae = pick(inf.vaes, [/^ae\./i, /flux/i]);
  if (!/^clip_l/i.test(clip1) || !/^t5xxl/i.test(clip2)) throw new Error(`FLUX text encoders not found (got ${clip1}, ${clip2})`);
  const subject = flag('--prompt'); if (!subject) throw new Error('art needs --prompt "what is in the picture"');
  const g = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    2: { class_type: 'DualCLIPLoader', inputs: { clip_name1: clip1, clip_name2: clip2, type: 'flux', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    4: { class_type: 'EmptySD3LatentImage', inputs: { width: +flag('--w', 1024), height: +flag('--h', 1024), batch_size: 1 } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: `${subject}, ${flag('--style', ART_STYLE)}`, clip: ['2', 0] } },
    6: { class_type: 'FluxGuidance', inputs: { conditioning: ['5', 0], guidance: +flag('--guidance', 3.5) } },
    7: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['5', 0] } },
    8: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['4', 0], seed, steps: +flag('--steps', 24), cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    9: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    10: { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'vdaa-art' } },
  };
  process.stdout.write(`art ${name} seed ${seed}: queued (${unet})`);
  return run(g, name, path.join(ROOT, 'design', 'art', `${name}-${seed}.png`));
}

// One look for every zone: cinematic, photoreal, blue-teal with honey wood. Every zone has a day and a night version
// (--time day|night, default night); the game shows the one that matches the school clock.
const STYLE = 'photorealistic architectural photography, cinematic fantasy game environment, royal blue and teal palette with honey-wood and gold accents, volumetric light, high detail, 35mm, no people';
const LIGHT = {
  night: 'at night, starry sky and green northern lights through the glass, warm lantern light',
  day: 'bright daytime, clear blue sky, sunlight pouring through the glass, soft natural daylight, crisp shadows',
};
const LIGHT_NEG = { night: 'daylight, sunshine', day: 'night, dark, stars, moon, aurora' };
const TIME = flag('--time', 'night');
if (!LIGHT[TIME]) throw new Error('--time must be day or night');
const NEGATIVE = 'people, person, face, crowd, text, letters, words, logo, watermark, signature, cartoon, anime, illustration, pixel art, blurry, lowres, deformed, oversaturated';

const SCENES = path.join(ROOT, 'design', 'scenes.json');
if (args[0] === '--info') console.log(JSON.stringify(await info(), null, 2));
else if (args[0] === 'mascot') {
  const inf = await info(), s0 = +flag('--seed', Math.floor(Math.random() * 1e9)), n = +flag('--n', 1);
  for (let i = 0; i < n; i++) await mascot(inf, s0 + i);
} else if (args[0] === 'art') {
  const inf = await info(), s0 = +flag('--seed', Math.floor(Math.random() * 1e9)), n = +flag('--n', 1);
  if (!args[1] || args[1].startsWith('--')) throw new Error('usage: art <name> --prompt "..." [--seed N] [--n 2]');
  if (!flag('--keep-loaded')) { await api('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }); await new Promise((r) => setTimeout(r, 3000)); }
  for (let i = 0; i < n; i++) await art(inf, args[1], s0 + i);
} else {
  const all = JSON.parse(fs.readFileSync(SCENES, 'utf8')), inf = await info();
  const zones = args[0] === 'all' ? Object.keys(all) : [args[0]];
  for (const zone of zones) {
    if (!all[zone]) throw new Error(`no zone "${zone}" in design/scenes.json (have: ${Object.keys(all).join(', ')})`);
    const s0 = +flag('--seed', Math.floor(Math.random() * 1e9)), n = +flag('--n', 1);
    for (let i = 0; i < n; i++) await render(zone, all[zone], inf, s0 + i);
  }
}
