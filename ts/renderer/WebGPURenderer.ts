/**
 * WebGPU 기반 RGSS 렌더러
 *
 * 하드웨어 가속을 위해 WebGPU 사용.
 * WebGPU 미지원 시 create()가 null 반환 → CanvasRenderer fallback.
 */
import { Graphics } from '../api/Graphics';
import type { Sprite } from '../api/Sprite';
import type { Tilemap } from '../api/Tilemap';
import type { Plane } from '../api/Plane';
import type { IRenderer } from './IRenderer';

const VERTEX_WGSL = /* wgsl */ `
struct VertexInput {
  @location(0) position: vec2<f32>,
  @location(1) uv: vec2<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) alpha: f32,
}

struct Uniforms {
  alpha: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  return VertexOutput(
    vec4<f32>(in.position, 0.0, 1.0),
    in.uv,
    uniforms.alpha,
  );
}
`;

const FRAGMENT_WGSL = /* wgsl */ `
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct FragmentInput {
  @location(0) uv: vec2<f32>,
  @location(1) alpha: f32,
}

@fragment
fn fs_main(in: FragmentInput) -> @location(0) vec4<f32> {
  let c = textureSample(tex, samp, in.uv);
  return vec4<f32>(c.rgb, c.a * in.alpha);
}
`;

export class WebGPURenderer implements IRenderer {
  private static nextInstanceId = 1;
  private static activeRendererByCanvas = new WeakMap<HTMLCanvasElement, number>();

  private _canvas: HTMLCanvasElement;
  private readonly instanceId: number;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private sampler: GPUSampler | null = null;

  private sprites: Sprite[] = [];
  private sortedSprites: Sprite[] = [];
  private tilemaps: Tilemap[] = [];
  private planes: Plane[] = [];
  private sortDirty = true;
  private backgroundColor = '#000000';

  /** Bitmap canvas → GPUTexture 캐시 (동일 캔버스 재사용, 크기 변경 시 재생성) */
  private textureCache = new WeakMap<
    HTMLCanvasElement,
    { texture: GPUTexture; view: GPUTextureView; width: number; height: number }
  >();

  private initialized = false;

  private constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this.instanceId = WebGPURenderer.nextInstanceId++;
    Graphics.setCanvas(canvas);
  }

  get canvas(): HTMLCanvasElement {
    return this._canvas;
  }

  /**
   * WebGPU 지원 시 WebGPURenderer 인스턴스 반환, 미지원 시 null.
   */
  static async create(canvas: HTMLCanvasElement): Promise<WebGPURenderer | null> {
    const renderer = new WebGPURenderer(canvas);
    const ok = await renderer.init();
    if (!ok) return null;
    return renderer;
  }

  private async init(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      if (!this.device) return false;

      this.device.lost.then((info) => {
        console.warn('[WebGPURenderer] Device lost:', info.reason);
        this.initialized = false;
        this.textureCache = new WeakMap();
        this.device = null;
        this.context = null;
        this.clearActiveRendererIfOwned();
      });

      const ctx = this._canvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) return false;

      const format = navigator.gpu.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
      ctx.configure({
        device: this.device,
        format,
        alphaMode: 'premultiplied',
      });
      this.context = ctx;
      this.markAsActiveRenderer();

      await this.createPipeline();
      this.initialized = true;
      return true;
    } catch (e) {
      console.warn('[WebGPURenderer] Init failed:', e);
      return false;
    }
  }

  private async createPipeline(): Promise<void> {
    if (!this.device) return;

    const shaderModule = this.device.createShaderModule({
      code: VERTEX_WGSL + '\n' + FRAGMENT_WGSL,
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    const format = navigator.gpu.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  setSize(width: number, height: number): void {
    this._canvas.width = width;
    this._canvas.height = height;
    Graphics.resizeScreen(width, height);
  }

  setBackgroundColor(color: string): void {
    this.backgroundColor = color;
  }

  addSprite(sprite: Sprite): void {
    if (!this.sprites.includes(sprite)) {
      this.sprites.push(sprite);
      (sprite as { _renderer: IRenderer | null })._renderer = this;
      this.sortDirty = true;
    }
  }

  removeSprite(sprite: Sprite): void {
    const i = this.sprites.indexOf(sprite);
    if (i >= 0) {
      (sprite as { _renderer: IRenderer | null })._renderer = null;
      this.sprites.splice(i, 1);
      this.sortDirty = true;
    }
  }

  addTilemap(tilemap: Tilemap): void {
    if (!this.tilemaps.includes(tilemap)) this.tilemaps.push(tilemap);
  }

  removeTilemap(tilemap: Tilemap): void {
    const i = this.tilemaps.indexOf(tilemap);
    if (i >= 0) this.tilemaps.splice(i, 1);
  }

  addPlane(plane: Plane): void {
    if (!this.planes.includes(plane)) this.planes.push(plane);
  }

  removePlane(plane: Plane): void {
    const i = this.planes.indexOf(plane);
    if (i >= 0) this.planes.splice(i, 1);
  }

  clearSprites(): void {
    for (const s of this.sprites) (s as { _renderer: IRenderer | null })._renderer = null;
    this.sprites = [];
    this.sortedSprites = [];
    this.tilemaps = [];
    this.planes = [];
    this.sortDirty = false;
  }

  markSortDirty(): void {
    this.sortDirty = true;
  }

  private ensureSorted(): void {
    if (!this.sortDirty) return;
    this.sortedSprites = [...this.sprites].sort((a, b) => {
      const dz = a.z - b.z;
      if (dz !== 0) return dz;
      return a.y - b.y;
    });
    this.sortDirty = false;
  }

  private markAsActiveRenderer(): void {
    WebGPURenderer.activeRendererByCanvas.set(this._canvas, this.instanceId);
  }

  private isActiveRenderer(): boolean {
    return WebGPURenderer.activeRendererByCanvas.get(this._canvas) === this.instanceId;
  }

  private clearActiveRendererIfOwned(): void {
    if (this.isActiveRenderer()) {
      WebGPURenderer.activeRendererByCanvas.delete(this._canvas);
    }
  }

  private getOrCreateTexture(bitmapCanvas: HTMLCanvasElement): { texture: GPUTexture; view: GPUTextureView } | null {
    if (!this.device) return null;
    const w = bitmapCanvas.width;
    const h = bitmapCanvas.height;
    if (w <= 0 || h <= 0) return null;

    let cached = this.textureCache.get(bitmapCanvas);
    if (!cached || cached.width !== w || cached.height !== h) {
      const texture = this.device.createTexture({
        size: [w, h, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      cached = { texture, view: texture.createView(), width: w, height: h };
      this.textureCache.set(bitmapCanvas, cached);
    }

    this.device.queue.copyExternalImageToTexture(
      { source: bitmapCanvas },
      { texture: cached.texture },
      [w, h, 1]
    );
    return { texture: cached.texture, view: cached.view };
  }

  private drawScene(): void {
    if (
      !this.isActiveRenderer() ||
      !this.device ||
      !this.context ||
      !this.pipeline ||
      !this.uniformBuffer ||
      !this.sampler ||
      !this.bindGroupLayout
    )
      return;

    const w = this._canvas.width;
    const h = this._canvas.height;

    const encoder = this.device.createCommandEncoder();
    const texture = this.context.getCurrentTexture();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: this.parseBackgroundColor(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);

    this.ensureSorted();

    const sortedPlanes = [...this.planes].sort((a, b) => a.z - b.z);
    for (const p of sortedPlanes) {
      this.drawPlane(pass, p, w, h);
    }
    for (const t of this.tilemaps) {
      this.drawTilemap(pass, t, w, h);
    }
    for (const s of this.sortedSprites) {
      this.drawSprite(pass, s, w, h);
    }

    pass.end();
    try {
      this.device.queue.submit([encoder.finish()]);
    } catch (err) {
      console.warn('[WebGPURenderer] Submit failed (device lost?):', err);
    }
  }

  private parseBackgroundColor(): [number, number, number, number] {
    const m = this.backgroundColor.match(/^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
    if (m) {
      return [
        parseInt(m[1]!, 16) / 255,
        parseInt(m[2]!, 16) / 255,
        parseInt(m[3]!, 16) / 255,
        1,
      ];
    }
    return [0, 0, 0, 1];
  }

  private drawSprite(pass: GPURenderPassEncoder, sprite: Sprite, _w: number, _h: number): void {
    if (!sprite.visible || sprite.disposed || !sprite.bitmap || sprite.bitmap.disposed) return;
    if (!sprite.bitmap.canvas || sprite.bitmap.canvas.width <= 0 || sprite.bitmap.canvas.height <= 0) return;

    const tex = this.getOrCreateTexture(sprite.bitmap.canvas);
    if (!tex) return;

    const src = sprite.srcRect;
    const sw = src.width || sprite.bitmap.width;
    const sh = src.height || sprite.bitmap.height;
    if (sw <= 0 || sh <= 0) return;

    const dw = sw * sprite.zoomX;
    const dh = sh * sprite.zoomY;
    const dx = sprite.x - sprite.ox * sprite.zoomX;
    const dy = sprite.y - sprite.oy * sprite.zoomY;

    const bw = sprite.bitmap.width;
    const bh = sprite.bitmap.height;
    let u0 = src.x / bw;
    const v0 = src.y / bh;
    let u1 = (src.x + sw) / bw;
    const v1 = (src.y + sh) / bh;
    if (sprite.mirror) [u0, u1] = [u1, u0];

    const w = this._canvas.width;
    const h = this._canvas.height;
    const toNdc = (px: number, py: number) => [
      2 * px / w - 1,
      -2 * py / h + 1,
    ];
    const [x0, y0] = toNdc(dx, dy);
    const [x1, y1] = toNdc(dx + dw, dy + dh);

    const vertices = new Float32Array([
      x0, y0, u0, v0,
      x1, y0, u1, v0,
      x0, y1, u0, v1,
      x0, y1, u0, v1,
      x1, y0, u1, v0,
      x1, y1, u1, v1,
    ]);

    const vertexBuffer = this.device!.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device!.queue.writeBuffer(vertexBuffer, 0, vertices);

    const alpha = sprite.opacity / 255;
    this.device!.queue.writeBuffer(this.uniformBuffer!, 0, new Float32Array([alpha]));

    const bindGroup = this.device!.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: tex.view },
        { binding: 2, resource: this.sampler! },
      ],
    });

    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(6, 1, 0, 0);
  }

  private drawTilemap(pass: GPURenderPassEncoder, tilemap: Tilemap, w: number, h: number): void {
    if (tilemap.disposed || !tilemap.mapData) return;
    const vp = tilemap.viewport;
    const vx = vp ? vp.rect.x : 0;
    const vy = vp ? vp.rect.y : 0;
    const vw = vp ? vp.rect.width : w;
    const vh = vp ? vp.rect.height : h;
    const ox = tilemap.ox + (vp ? vp.ox : 0);
    const oy = tilemap.oy + (vp ? vp.oy : 0);

    const xsize = tilemap.mapData.xsize;
    const ysize = tilemap.mapData.ysize;
    const zsize = Math.min(tilemap.mapData.zsize, 3);
    const TILE_SIZE = 32;

    const startX = Math.floor((-vx + ox) / TILE_SIZE);
    const startY = Math.floor((-vy + oy) / TILE_SIZE);
    const endX = Math.ceil((vw - vx + ox) / TILE_SIZE) + 1;
    const endY = Math.ceil((vh - vy + oy) / TILE_SIZE) + 1;

    const toNdc = (px: number, py: number) => [
      2 * px / this._canvas.width - 1,
      -2 * py / this._canvas.height + 1,
    ];

    for (let z = 0; z < zsize; z++) {
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const gx = ((x + xsize) % xsize + xsize) % xsize;
          const gy = ((y + ysize) % ysize + ysize) % ysize;
          const tileId = tilemap.mapData.get(gx, gy, z);
          if (tileId <= 0) continue;
          const bmpIdx = Math.min(Math.floor(tileId / 2048), tilemap.bitmaps.length - 1);
          const bmp = tilemap.bitmaps[Math.max(0, bmpIdx)];
          if (!bmp || bmp.disposed || !bmp.canvas) continue;

          const id = tileId & 0x3ff;
          const tilesPerRow = Math.floor(bmp.width / TILE_SIZE) || 1;
          const row = Math.floor(id / tilesPerRow);
          const col = id % tilesPerRow;
          const sx = col * TILE_SIZE;
          const sy = row * TILE_SIZE;

          const dx = vx + x * TILE_SIZE - ox;
          const dy = vy + y * TILE_SIZE - oy;

          const tex = this.getOrCreateTexture(bmp.canvas);
          if (!tex) continue;

          const bw = bmp.width;
          const bh = bmp.height;
          const u0 = sx / bw;
          const v0 = sy / bh;
          const u1 = (sx + TILE_SIZE) / bw;
          const v1 = (sy + TILE_SIZE) / bh;

          const [x0, y0] = toNdc(dx, dy);
          const [x1, y1] = toNdc(dx + TILE_SIZE, dy + TILE_SIZE);

          const vertices = new Float32Array([
            x0, y0, u0, v0, x1, y0, u1, v0, x0, y1, u0, v1,
            x0, y1, u0, v1, x1, y0, u1, v0, x1, y1, u1, v1,
          ]);
          const vertexBuffer = this.device!.createBuffer({
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          this.device!.queue.writeBuffer(vertexBuffer, 0, vertices);
          this.device!.queue.writeBuffer(this.uniformBuffer!, 0, new Float32Array([1]));

          const bindGroup = this.device!.createBindGroup({
            layout: this.bindGroupLayout!,
            entries: [
              { binding: 0, resource: { buffer: this.uniformBuffer! } },
              { binding: 1, resource: tex.view },
              { binding: 2, resource: this.sampler! },
            ],
          });
          pass.setBindGroup(0, bindGroup);
          pass.setVertexBuffer(0, vertexBuffer);
          pass.draw(6, 1, 0, 0);
        }
      }
    }
  }

  private drawPlane(pass: GPURenderPassEncoder, plane: Plane, w: number, h: number): void {
    if (plane.disposed || !plane.bitmap || plane.bitmap.disposed || !plane.bitmap.canvas) return;
    const vp = plane.viewport;
    const vx = vp ? vp.rect.x : 0;
    const vy = vp ? vp.rect.y : 0;
    const vw = vp ? vp.rect.width : w;
    const vh = vp ? vp.rect.height : h;
    const ox = plane.ox + (vp ? vp.ox : 0);
    const oy = plane.oy + (vp ? vp.oy : 0);

    const bw = plane.bitmap.width * plane.zoomX;
    const bh = plane.bitmap.height * plane.zoomY;
    let startX = vx - (ox % bw);
    let startY = vy - (oy % bh);

    const tex = this.getOrCreateTexture(plane.bitmap.canvas);
    if (!tex) return;

    const alpha = plane.opacity / 255;
    const toNdc = (px: number, py: number) => [
      2 * px / this._canvas.width - 1,
      -2 * py / this._canvas.height + 1,
    ];

    for (let dy = startY; dy < vy + vh + bh; dy += bh) {
      for (let dx = startX; dx < vx + vw + bw; dx += bw) {
        const [x0, y0] = toNdc(dx, dy);
        const [x1, y1] = toNdc(dx + bw, dy + bh);

        const vertices = new Float32Array([
          x0, y0, 0, 1, x1, y0, 1, 1, x0, y1, 0, 0,
          x0, y1, 0, 0, x1, y0, 1, 1, x1, y1, 1, 0,
        ]);
        const vertexBuffer = this.device!.createBuffer({
          size: vertices.byteLength,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device!.queue.writeBuffer(vertexBuffer, 0, vertices);
        this.device!.queue.writeBuffer(this.uniformBuffer!, 0, new Float32Array([alpha]));

        const bindGroup = this.device!.createBindGroup({
          layout: this.bindGroupLayout!,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer! } },
            { binding: 1, resource: tex.view },
            { binding: 2, resource: this.sampler! },
          ],
        });
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(6, 1, 0, 0);
      }
    }
  }

  render(): void {
    if (!this.initialized || !this.device || !this.context || !this.isActiveRenderer()) return;

    const state = Graphics.transitionState;
    const w = this._canvas.width;
    const h = this._canvas.height;

    if (state === 'frozen') {
      const snap = Graphics.frozenSnap;
      if (snap) {
        this.drawImageToCanvas(snap, 0, 0, w, h);
      } else {
        this.drawClearColor();
      }
      return;
    }

    if (state === 'transitioning') {
      this.drawScene();
      const t = Graphics.transitionT;
      const snap = Graphics.frozenSnap;
      if (snap) {
        this.drawTransitionBlend(snap, t, w, h);
      }
      if (Graphics.brightness < 255) {
        this.drawBrightnessOverlay(w, h);
      }
      return;
    }

    this.drawScene();

    if (Graphics.brightness < 255) {
      this.drawBrightnessOverlay(w, h);
    }
  }

  private drawImageToCanvas(snap: HTMLCanvasElement, x: number, y: number, w: number, h: number): void {
    const tex = this.getOrCreateTexture(snap);
    if (
      !this.isActiveRenderer() ||
      !tex ||
      !this.device ||
      !this.context ||
      !this.pipeline ||
      !this.uniformBuffer ||
      !this.sampler ||
      !this.bindGroupLayout
    )
      return;

    const encoder = this.device.createCommandEncoder();
    const texture = this.context.getCurrentTexture();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: this.parseBackgroundColor(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);

    const vertices = new Float32Array([
      -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0,
      -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0,
    ]);
    const vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, vertices);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([1]));

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: tex.view },
        { binding: 2, resource: this.sampler },
      ],
    });
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(6, 1, 0, 0);
    pass.end();
    try {
      this.device.queue.submit([encoder.finish()]);
    } catch (err) {
      console.warn('[WebGPURenderer] Submit failed (device/context mismatch?):', err);
    }
  }

  private drawClearColor(): void {
    if (!this.isActiveRenderer() || !this.device || !this.context) return;
    const encoder = this.device.createCommandEncoder();
    const texture = this.context.getCurrentTexture();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: this.parseBackgroundColor(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.end();
    try {
      this.device.queue.submit([encoder.finish()]);
    } catch (err) {
      console.warn('[WebGPURenderer] Submit failed while clearing:', err);
    }
  }

  private drawTransitionBlend(snap: HTMLCanvasElement, t: number, w: number, h: number): void {
    if (
      !this.isActiveRenderer() ||
      !this.device ||
      !this.context ||
      !this.pipeline ||
      !this.uniformBuffer ||
      !this.sampler ||
      !this.bindGroupLayout
    )
      return;
    const snapAlpha = 1 - t;
    const tex = this.getOrCreateTexture(snap);
    if (!tex) return;

    const encoder = this.device.createCommandEncoder();
    const texture = this.context.getCurrentTexture();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          loadOp: 'load',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);

    const vertices = new Float32Array([
      -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0,
      -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0,
    ]);
    const vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, vertices);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([snapAlpha]));

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: tex.view },
        { binding: 2, resource: this.sampler },
      ],
    });
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(6, 1, 0, 0);
    pass.end();
    try {
      this.device.queue.submit([encoder.finish()]);
    } catch (err) {
      console.warn('[WebGPURenderer] Submit failed during transition:', err);
    }
  }

  private drawBrightnessOverlay(w: number, h: number): void {
    if (!this.isActiveRenderer() || !this.device || !this.context || !this.pipeline) return;
    const brightness = Graphics.brightness;
    if (brightness >= 255) return;
    const alpha = (255 - brightness) / 255;

    const encoder = this.device.createCommandEncoder();
    const texture = this.context.getCurrentTexture();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          loadOp: 'load',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, new Float32Array([alpha]));

    const blackTex = this.getOrCreateTexture(this.createBlackTexture());
    if (blackTex) {
      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer! } },
          { binding: 1, resource: blackTex.view },
          { binding: 2, resource: this.sampler! },
        ],
      });
      const vertices = new Float32Array([
        -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0,
        -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0,
      ]);
      const vertexBuffer = this.device.createBuffer({
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(vertexBuffer, 0, vertices);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.draw(6, 1, 0, 0);
    }
    pass.end();
    try {
      this.device.queue.submit([encoder.finish()]);
    } catch (err) {
      console.warn('[WebGPURenderer] Submit failed during brightness overlay:', err);
    }
  }

  private blackTextureCanvas: HTMLCanvasElement | null = null;

  private createBlackTexture(): HTMLCanvasElement {
    if (!this.blackTextureCanvas) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 1, 1);
      this.blackTextureCanvas = c;
    }
    return this.blackTextureCanvas;
  }

  update(): void {
    Graphics.update();
    for (let i = 0; i < this.sprites.length; i++) {
      this.sprites[i]!.update();
    }
  }
}
