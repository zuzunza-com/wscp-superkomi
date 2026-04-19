/**
 * WasmRgssBridge.ts - WASM ↔ JS RGSS API 브릿지
 *
 * Emscripten 모듈이 import로 요구하는 JS 함수들을 구현한다.
 * 각 함수는 기존 WebRGSS API(Graphics, Bitmap, Sprite 등) 에 위임한다.
 *
 * 객체 레지스트리: Bitmap/Sprite/Viewport/Window/Tilemap/Table 은
 * int32 ID로 관리된다. 0 은 무효 ID.
 */

import { Graphics } from '../api/Graphics';
import { Bitmap } from '../api/Bitmap';
import { Sprite } from '../api/Sprite';
import { Viewport } from '../api/Viewport';
import { Window } from '../api/Window';
import { Audio, audioPumpPending } from '../api/Audio';
import { Input, InputState } from '../api/Input';
import { Color } from '../api/Color';
import { Tone } from '../api/Tone';
import { Rect } from '../api/Rect';
import { Table } from '../api/Table';
import { Tilemap } from '../api/Tilemap';
import { Plane } from '../api/Plane';
import type { IRenderer } from '../renderer/IRenderer';
import type { IResourceLoader } from '../resources/types';
import { decodeRubyMarshalToJs } from '../rvdata2/ruby-marshal-rgss';
import { sanitizeFsPath } from './path-sanitize';

/* ====================================================
 * 범용 객체 레지스트리
 * ==================================================== */
class ObjectRegistry<T> {
  private map = new Map<number, T>();
  private nextId = 1;

  forEach(fn: (obj: T, id: number) => void): void {
    for (const [id, obj] of this.map) fn(obj, id);
  }

  add(obj: T): number {
    const id = this.nextId++;
    this.map.set(id, obj);
    return id;
  }

  get(id: number): T | undefined {
    return this.map.get(id);
  }

  delete(id: number): void {
    this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
    this.nextId = 1;
  }
}

/* ====================================================
 * 파일 캐시 (게임 리소스)
 * ==================================================== */
interface FileEntry {
  data: Uint8Array;
}

export interface WasmRgssBridgeOptions {
  renderer: IRenderer;
  loader: IResourceLoader;
}

/**
 * WASM 모듈에 주입할 JS import 객체를 생성한다.
 * Emscripten `env` 네임스페이스에 등록된다.
 */
export class WasmRgssBridge {
  private readonly renderer: IRenderer;
  private readonly loader: IResourceLoader;

  private readonly bitmaps  = new ObjectRegistry<Bitmap>();
  private readonly sprites  = new ObjectRegistry<Sprite>();
  private readonly viewports = new ObjectRegistry<Viewport>();
  private readonly windows  = new ObjectRegistry<Window>();
  private readonly tables   = new ObjectRegistry<Table>();
  private readonly tilemaps = new ObjectRegistry<Tilemap>();
  private readonly planes   = new ObjectRegistry<Plane>();
  private readonly fileCache = new Map<string, FileEntry>();
  /** rvdata2 → JSON 변환 캐시: mruby에 Marshal이 없으므로 JS에서 미리 변환 */
  private readonly jsonCache = new Map<string, Uint8Array>();

  constructor(opts: WasmRgssBridgeOptions) {
    this.renderer = opts.renderer;
    this.loader = opts.loader;
  }

  dispose(): void {
    this.bitmaps.clear();
    this.sprites.clear();
    this.viewports.clear();
    this.windows.clear();
    this.tables.clear();
    this.tilemaps.clear();
    this.planes.clear();
    this.fileCache.clear();
    this.jsonCache.clear();
  }

  /** 스크립트 실행 직후 등에서 화면을 한 번 갱신할 때 호출 */
  triggerRender(): void {
    this.renderer.render();
  }

  /* ====================================================
   * Emscripten imports 객체 빌드
   * ==================================================== */
  buildImports(): Record<string, unknown> {
    const env: Record<string, unknown> = {};

    /* --- Graphics --- */
    /* fnTick 미사용: JS rAF에서 execBootstrap(FRAME_TICK_SCRIPT)로 1프레임 구동. 동기 호출만 필요. */
    env['js_graphics_update'] = () => {
      InputState.update();
      this.renderer.update();
      this.renderer.render();
      audioPumpPending();
    };
    env['js_graphics_wait'] = (_duration: number) => {
      InputState.update();
      this.renderer.update();
      this.renderer.render();
      audioPumpPending();
    };
    env['js_graphics_fadeout'] = (duration: number) => Graphics.fadeout(duration);
    env['js_graphics_fadein']  = (duration: number) => Graphics.fadein(duration);
    env['js_graphics_freeze']  = () => Graphics.freeze();
    env['js_graphics_transition'] = (duration: number, _filenamePtr: number, vague: number) => {
      Graphics.transition(duration, undefined, vague);
    };
    env['js_graphics_snap_to_bitmap'] = () => {
      const snap = Graphics.snapToBitmap();
      return snap ? this.bitmaps.add(snap) : 0;
    };
    env['js_graphics_frame_reset']    = () => { (Graphics as unknown as { _frameCount: number })['_frameCount'] = 0; };
    env['js_graphics_get_width']      = () => Graphics.width;
    env['js_graphics_get_height']     = () => Graphics.height;
    env['js_graphics_resize_screen']  = (w: number, h: number) => Graphics.resizeScreen(w, h);
    env['js_graphics_get_frame_rate'] = () => Graphics.frameRate;
    env['js_graphics_set_frame_rate'] = (v: number) => { Graphics.frameRate = v; };
    env['js_graphics_get_frame_count']= () => Graphics.frameCount;
    env['js_graphics_set_frame_count']= (v: number) => { (Graphics as unknown as { _frameCount: number })['_frameCount'] = v; };
    env['js_graphics_get_brightness'] = () => Graphics.brightness;
    env['js_graphics_set_brightness'] = (v: number) => { Graphics.brightness = v; };
    env['js_graphics_play_movie']     = () => { /* no-op: 웹에서 미지원 */ };

    /* --- Audio --- */
    env['js_audio_bgm_play'] = (namePtr: number, volume: number, pitch: number, pos: number) => {
      const name = this.readStr(namePtr);
      Audio.bgmPlay(name, volume, pitch, pos);
    };
    env['js_audio_bgm_stop'] = () => Audio.bgmStop();
    env['js_audio_bgm_fade'] = (time: number) => Audio.bgmFade(time);
    env['js_audio_bgm_pos']  = () => Audio.bgmPos();
    env['js_audio_bgs_play'] = (namePtr: number, volume: number, pitch: number, pos: number) => {
      Audio.bgsPlay(this.readStr(namePtr), volume, pitch, pos);
    };
    env['js_audio_bgs_stop'] = () => Audio.bgsStop();
    env['js_audio_bgs_fade'] = (time: number) => Audio.bgsFade(time);
    env['js_audio_bgs_pos']  = () => Audio.bgsPos();
    env['js_audio_me_play']  = (namePtr: number, volume: number, pitch: number) => {
      Audio.mePlay(this.readStr(namePtr), volume, pitch);
    };
    env['js_audio_me_stop']  = () => Audio.meStop();
    env['js_audio_me_fade']  = (time: number) => Audio.meFade(time);
    env['js_audio_se_play']  = (namePtr: number, volume: number, pitch: number) => {
      Audio.sePlay(this.readStr(namePtr), volume, pitch);
    };
    env['js_audio_se_stop']  = () => Audio.seStop();

    /* --- Input --- */
    env['js_input_press']   = (code: number) => InputState.press(codeToSym(code)) ? 1 : 0;
    env['js_input_trigger'] = (code: number) => InputState.trigger(codeToSym(code)) ? 1 : 0;
    env['js_input_repeat']  = (code: number) => InputState.repeat(codeToSym(code)) ? 1 : 0;
    env['js_input_dir4']    = () => InputState.dir4();
    env['js_input_dir8']    = () => InputState.dir8();

    /* --- Bitmap --- */
    env['js_bitmap_create'] = (w: number, h: number) => {
      const bmp = new Bitmap(w, h);
      return this.bitmaps.add(bmp);
    };
    env['js_bitmap_load'] = (pathPtr: number) => {
      const path = this.readStr(pathPtr);
      const bmp = new Bitmap(path);
      /* 비동기 로드 - getImageUrl로 경로 해석 후 이미지 로드 */
      Bitmap.loadFromResource((p) => this.loader.getImageUrl(p), path).then((loaded) => {
        if (loaded && loaded.canvas && loaded.canvas.width > 0 && loaded.canvas.height > 0) {
          bmp.replaceFromLoaded(loaded);
          // Window skin bitmap은 set 시점에 1x1 placeholder였을 수 있으므로,
          // 실제 이미지 로드 완료 후 연결된 Window를 다시 그려준다.
          this.windows.forEach((win) => {
            if (win.disposed) return;
            if (win.windowskin === bmp) {
              win.redrawWindow();
            }
          });
          /* 타이틀 계열 비트맵: 스프라이트를 이미지 중심 기준으로 화면 중앙 배치, cover 스케일 */
          const isTitleLike = /Title|Titles|Parallaxes/i.test(path);
          if (isTitleLike) {
            const gw = Graphics.width;
            const gh = Graphics.height;
            const bw = loaded.width;
            const bh = loaded.height;
            this.sprites.forEach((spr) => {
              if (spr.bitmap !== bmp || spr.disposed) return;
              /* srcRect 갱신: 비동기 로드 전 C가 (0,0,1,1) 등으로 설정했을 수 있음 */
              spr.srcRect.x = 0;
              spr.srcRect.y = 0;
              spr.srcRect.width = bw;
              spr.srcRect.height = bh;
              spr.ox = bw / 2;
              spr.oy = bh / 2;
              spr.x = gw / 2;
              spr.y = gh / 2;
              if (bw !== gw || bh !== gh) {
                const scale = Math.max(gw / bw, gh / bh);
                spr.zoomX = scale;
                spr.zoomY = scale;
              }
            });
          }
        }
      }).catch((err) => {
        console.error('[js_bitmap_load] Bitmap 로드 실패:', path, err instanceof Error ? err.message : String(err));
      });
      return this.bitmaps.add(bmp);
    };
    env['js_bitmap_dispose'] = (id: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) { bmp.dispose(); this.bitmaps.delete(id); }
    };
    env['js_bitmap_clone'] = (id: number) => {
      const src = this.bitmaps.get(id);
      if (!src || src.disposed) return 0;
      try {
        const cloned = src.clone();
        return this.bitmaps.add(cloned);
      } catch {
        return 0;
      }
    };
    env['js_bitmap_width']  = (id: number) => this.bitmaps.get(id)?.width ?? 0;
    env['js_bitmap_height'] = (id: number) => this.bitmaps.get(id)?.height ?? 0;

    env['js_bitmap_blt'] = (dstId: number, dx: number, dy: number,
                             srcId: number, sx: number, sy: number, sw: number, sh: number,
                             opacity: number) => {
      const dst = this.bitmaps.get(dstId);
      const src = this.bitmaps.get(srcId);
      if (dst && src) dst.blt(dx, dy, src, new Rect(sx, sy, sw, sh), opacity);
    };
    env['js_bitmap_stretch_blt'] = (dstId: number, ddx: number, ddy: number, ddw: number, ddh: number,
                                     srcId: number, sx: number, sy: number, sw: number, sh: number,
                                     opacity: number) => {
      const dst = this.bitmaps.get(dstId);
      const src = this.bitmaps.get(srcId);
      if (dst && src) dst.stretchBlt(new Rect(ddx, ddy, ddw, ddh), src, new Rect(sx, sy, sw, sh), opacity);
    };
    env['js_bitmap_fill_rect'] = (id: number, x: number, y: number, w: number, h: number,
                                   r: number, g: number, b: number, a: number) => {
      const bmp = this.bitmaps.get(id);
      if (!bmp) return;
      const ctx = bmp.context;
      ctx.clearRect(x, y, w, h);
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(x, y, w, h);
    };
    env['js_bitmap_gradient_fill_rect'] = (id: number, x: number, y: number, w: number, h: number,
                                            r1: number, g1: number, b1: number, a1: number,
                                            r2: number, g2: number, b2: number, a2: number,
                                            vertical: number) => {
      const bmp = this.bitmaps.get(id);
      if (!bmp) return;
      const ctx = bmp.context;
      const grad = vertical
        ? ctx.createLinearGradient(x, y, x, y + h)
        : ctx.createLinearGradient(x, y, x + w, y);
      grad.addColorStop(0, `rgba(${r1},${g1},${b1},${a1 / 255})`);
      grad.addColorStop(1, `rgba(${r2},${g2},${b2},${a2 / 255})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    };
    env['js_bitmap_clear']      = (id: number) => this.bitmaps.get(id)?.clear();
    env['js_bitmap_clear_rect'] = (id: number, x: number, y: number, w: number, h: number) =>
      this.bitmaps.get(id)?.clearRect(x, y, w, h);

    env['js_bitmap_get_pixel'] = (id: number, x: number, y: number) => {
      const bmp = this.bitmaps.get(id);
      if (!bmp) return 0;
      const data = bmp.context.getImageData(x, y, 1, 1).data;
      return ((data[0]! & 0xff) << 24) | ((data[1]! & 0xff) << 16) | ((data[2]! & 0xff) << 8) | (data[3]! & 0xff);
    };
    env['js_bitmap_set_pixel'] = (id: number, x: number, y: number, r: number, g: number, b: number, a: number) => {
      const bmp = this.bitmaps.get(id);
      if (!bmp) return;
      bmp.context.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      bmp.context.fillRect(x, y, 1, 1);
    };
    /* hue_change, blur, radial_blur - Canvas 기반 구현 (근사치) */
    env['js_bitmap_hue_change'] = (id: number, hue: number) => {
      const b = this.bitmaps.get(id);
      if (b) b.hueChange(hue);
    };
    env['js_bitmap_blur']       = (id: number) => {
      const bmp = this.bitmaps.get(id);
      if (!bmp) return;
      bmp.context.filter = 'blur(1px)';
      const img = bmp.context.getImageData(0, 0, bmp.width, bmp.height);
      bmp.context.filter = 'none';
      bmp.context.putImageData(img, 0, 0);
    };
    env['js_bitmap_radial_blur'] = (id: number, angle: number, div: number) => {
      const b = this.bitmaps.get(id);
      if (b) b.radialBlur(angle, div);
    };
    env['js_bitmap_draw_text'] = (id: number, x: number, y: number, w: number, h: number,
                                   strPtr: number, align: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) bmp.drawText(x, y, w, h, this.readStr(strPtr), align);
    };
    env['js_bitmap_text_size'] = (id: number, strPtr: number, outWPtr: number, outHPtr: number) => {
      const bmp = this.bitmaps.get(id);
      if (!bmp || !this._mem) return;
      const r = bmp.textSize(this.readStr(strPtr));
      this._mem.HEAP32[outWPtr >> 2] = r.width;
      this._mem.HEAP32[outHPtr >> 2] = r.height;
    };
    env['js_bitmap_set_font_name']    = (id: number, namePtr: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) bmp.font.name = this.readStr(namePtr);
    };
    env['js_bitmap_set_font_size']    = (id: number, size: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) bmp.font.size = size;
    };
    env['js_bitmap_set_font_bold']    = (id: number, v: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) bmp.font.bold = v !== 0;
    };
    env['js_bitmap_set_font_italic']  = (id: number, v: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) bmp.font.italic = v !== 0;
    };
    env['js_bitmap_set_font_shadow']  = (id: number, v: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) bmp.font.shadow = v !== 0;
    };
    env['js_bitmap_set_font_outline'] = (id: number, v: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) bmp.font.outline = v !== 0;
    };
    env['js_bitmap_set_font_color']   = (id: number, r: number, g: number, b: number, a: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) bmp.font.color = new Color(r, g, b, a);
    };
    env['js_bitmap_set_font_out_color'] = (id: number, r: number, g: number, b: number, a: number) => {
      const bmp = this.bitmaps.get(id);
      if (bmp) bmp.font.outColor = new Color(r, g, b, a);
    };

    /* --- Sprite --- */
    env['js_sprite_create'] = (viewportId: number) => {
      const vpt = viewportId ? this.viewports.get(viewportId) : undefined;
      const spr = new Sprite(vpt ?? null);
      const id = this.sprites.add(spr);
      this.renderer.addSprite(spr);
      return id;
    };
    env['js_sprite_dispose'] = (id: number) => {
      const spr = this.sprites.get(id);
      if (spr) {
        this.renderer.removeSprite(spr);
        spr.dispose();
        this.sprites.delete(id);
      }
    };
    env['js_sprite_update']   = (id: number) => this.sprites.get(id)?.update();
    env['js_sprite_flash']    = (id: number, r: number, g: number, b: number, a: number, dur: number) =>
      this.sprites.get(id)?.flash(new Color(r, g, b, a), dur);
    env['js_sprite_set_bitmap'] = (id: number, bmpId: number) => {
      const spr = this.sprites.get(id);
      if (spr) spr.bitmap = bmpId ? (this.bitmaps.get(bmpId) ?? null) : null;
    };
    env['js_sprite_set_src_rect'] = (id: number, x: number, y: number, w: number, h: number) => {
      const spr = this.sprites.get(id);
      if (spr) spr.srcRect = new Rect(x, y, w, h);
    };
    env['js_sprite_set_visible']    = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.visible=v!==0; };
    env['js_sprite_set_x']          = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.x=v; };
    env['js_sprite_set_y']          = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.y=v; };
    env['js_sprite_set_z']          = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.z=v; };
    env['js_sprite_set_ox']         = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.ox=v; };
    env['js_sprite_set_oy']         = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.oy=v; };
    env['js_sprite_set_zoom_x']     = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.zoomX=v; };
    env['js_sprite_set_zoom_y']     = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.zoomY=v; };
    env['js_sprite_set_angle']      = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.angle=v; };
    env['js_sprite_set_mirror']      = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.mirror=v!==0; };
    env['js_sprite_set_opacity']     = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.opacity=v; };
    env['js_sprite_set_blend_type']  = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.blendType=v; };
    env['js_sprite_set_bush_depth']  = (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.bushDepth=v; };
    env['js_sprite_set_bush_opacity']= (id: number, v: number) => { const s=this.sprites.get(id); if(s) s.bushOpacity=v; };
    env['js_sprite_set_color'] = (id: number, r: number, g: number, b: number, a: number) => {
      const s=this.sprites.get(id); if(s) s.color=new Color(r,g,b,a);
    };
    env['js_sprite_set_tone']  = (id: number, r: number, g: number, b: number, gray: number) => {
      const s=this.sprites.get(id); if(s) s.tone=new Tone(r,g,b,gray);
    };
    env['js_sprite_get_x']     = (id: number) => this.sprites.get(id)?.x ?? 0;
    env['js_sprite_get_y']     = (id: number) => this.sprites.get(id)?.y ?? 0;
    env['js_sprite_get_z']     = (id: number) => this.sprites.get(id)?.z ?? 0;
    env['js_sprite_width']     = (id: number) => this.sprites.get(id)?.width ?? 0;
    env['js_sprite_height']    = (id: number) => this.sprites.get(id)?.height ?? 0;

    /* --- Viewport --- */
    env['js_viewport_create'] = (x: number, y: number, w: number, h: number) => {
      const vw = w > 0 ? w : Graphics.width;
      const vh = h > 0 ? h : Graphics.height;
      const vpt = new Viewport(new Rect(x, y, vw, vh));
      return this.viewports.add(vpt);
    };
    env['js_viewport_dispose'] = (id: number) => {
      const v=this.viewports.get(id); if(v){ v.dispose(); this.viewports.delete(id); }
    };
    env['js_viewport_update'] = (id: number) => this.viewports.get(id)?.update();
    env['js_viewport_flash']  = (id: number, r: number, g: number, b: number, a: number, dur: number) =>
      this.viewports.get(id)?.flash(new Color(r,g,b,a), dur);
    env['js_viewport_set_rect']    = (id: number, x: number, y: number, w: number, h: number) => {
      const v=this.viewports.get(id); if(v) v.rect=new Rect(x,y,w,h);
    };
    env['js_viewport_set_visible'] = (id: number, v: number) => { const vp=this.viewports.get(id); if(vp) vp.visible=v!==0; };
    env['js_viewport_set_z']  = (id: number, v: number) => { const vp=this.viewports.get(id); if(vp) vp.z=v; };
    env['js_viewport_set_ox'] = (id: number, v: number) => { const vp=this.viewports.get(id); if(vp) vp.ox=v; };
    env['js_viewport_set_oy'] = (id: number, v: number) => { const vp=this.viewports.get(id); if(vp) vp.oy=v; };
    env['js_viewport_set_color'] = (id: number, r: number, g: number, b: number, a: number) => {
      const v=this.viewports.get(id); if(v) v.color=new Color(r,g,b,a);
    };
    env['js_viewport_set_tone']  = (id: number, r: number, g: number, b: number, gray: number) => {
      const v=this.viewports.get(id); if(v) v.tone=new Tone(r,g,b,gray);
    };

    /* --- Tilemap --- */
    env['js_tilemap_create'] = (viewportId: number) => {
      const vpt = viewportId ? this.viewports.get(viewportId) : null;
      const tm = new Tilemap(vpt ?? null);
      const id = this.tilemaps.add(tm);
      tm.setRenderer(this.renderer);
      return id;
    };
    env['js_tilemap_dispose'] = (id: number) => {
      const tm = this.tilemaps.get(id);
      if (tm) { tm.dispose(); this.tilemaps.delete(id); }
    };
    env['js_tilemap_set_map_data'] = (id: number, tableId: number) => {
      const tm = this.tilemaps.get(id);
      const tbl = this.tables.get(tableId);
      if (tm) tm.mapData = tbl ?? null;
    };
    env['js_tilemap_set_bitmap'] = (id: number, index: number, bitmapId: number) => {
      const tm = this.tilemaps.get(id);
      const bmp = bitmapId ? this.bitmaps.get(bitmapId) : null;
      if (tm) {
        while (tm.bitmaps.length <= index) tm.bitmaps.push(null);
        tm.bitmaps[index] = bmp ?? null;
      }
    };
    env['js_tilemap_set_flags'] = (id: number, tableId: number) => {
      const tm = this.tilemaps.get(id);
      const tbl = this.tables.get(tableId);
      if (tm) tm.flags = tbl ?? null;
    };
    env['js_tilemap_set_flash_data'] = (id: number, tableId: number) => {
      const tm = this.tilemaps.get(id);
      const tbl = this.tables.get(tableId);
      if (tm) tm.flashData = tbl ?? null;
    };
    env['js_tilemap_set_visible'] = (id: number, v: number) => {
      const tm = this.tilemaps.get(id);
      if (tm) tm.visible = v !== 0;
    };
    env['js_tilemap_set_ox'] = (id: number, v: number) => { const tm=this.tilemaps.get(id); if(tm) tm.ox=v; };
    env['js_tilemap_set_oy'] = (id: number, v: number) => { const tm=this.tilemaps.get(id); if(tm) tm.oy=v; };
    env['js_tilemap_update'] = (id: number) => this.tilemaps.get(id)?.update();

    /* --- Plane --- */
    env['js_plane_create'] = (viewportId: number) => {
      const vpt = viewportId ? this.viewports.get(viewportId) : null;
      const pl = new Plane(vpt ?? null);
      const id = this.planes.add(pl);
      pl.setRenderer(this.renderer);
      return id;
    };
    env['js_plane_dispose'] = (id: number) => {
      const pl = this.planes.get(id);
      if (pl) { pl.dispose(); this.planes.delete(id); }
    };
    env['js_plane_set_bitmap'] = (id: number, bitmapId: number) => {
      const pl = this.planes.get(id);
      const bmp = bitmapId ? this.bitmaps.get(bitmapId) : null;
      if (pl) pl.bitmap = bmp ?? null;
    };
    env['js_plane_set_ox'] = (id: number, v: number) => { const pl=this.planes.get(id); if(pl) pl.ox=v; };
    env['js_plane_set_oy'] = (id: number, v: number) => { const pl=this.planes.get(id); if(pl) pl.oy=v; };
    env['js_plane_set_z'] = (id: number, v: number) => { const pl=this.planes.get(id); if(pl) pl.z=v; };
    env['js_plane_update'] = (id: number) => this.planes.get(id)?.update();

    /* --- Window --- */
    env['js_window_create'] = (x: number, y: number, w: number, h: number) => {
      const win = new Window(x, y, Math.max(1, w), Math.max(1, h));
      const id = this.windows.add(win);
      this.renderer.addSprite(win);
      return id;
    };
    env['js_window_dispose'] = (id: number) => {
      const w=this.windows.get(id);
      if(w){ this.renderer.removeSprite(w); w.dispose(); this.windows.delete(id); }
    };
    env['js_window_update'] = (id: number) => this.windows.get(id)?.update();
    env['js_window_move']   = (id: number, x: number, y: number, nw: number, nh: number) => {
      const w=this.windows.get(id);
      if(w){ w.x=x; w.y=y; if(nw>0) w.windowWidth=nw; if(nh>0) w.windowHeight=nh; }
    };
    env['js_window_open']   = (id: number) => {
      const w=this.windows.get(id);
      return (!w || w.isOpen()) ? 1 : 0;
    };
    env['js_window_close']  = (id: number) => {
      const w=this.windows.get(id);
      return (!w || w.isClosed()) ? 1 : 0;
    };
    env['js_window_do_open']  = (id: number) => { const w=this.windows.get(id); w?.open(); };
    env['js_window_do_close'] = (id: number) => { const w=this.windows.get(id); w?.close(); };
    env['js_window_set_windowskin'] = (id: number, bmpId: number) => {
      const w = this.windows.get(id);
      const bmp = bmpId ? this.bitmaps.get(bmpId) : null;
      if (w) {
        w.windowskin = bmp ?? null;
        w.redrawWindow();
      }
    };
    env['js_window_set_contents'] = (id: number, bmpId: number) => {
      const w = this.windows.get(id);
      if (!w) return;
      if (bmpId) {
        const bmp = this.bitmaps.get(bmpId);
        if (bmp) w.contents = bmp;
      }
    };
    env['js_window_set_cursor_rect'] = (id: number, x: number, y: number, w: number, h: number) => {
      const win=this.windows.get(id);
      if(win) win.setCursorRect(x, y, w, h);
    };
    env['js_window_set_active']          = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.active=v!==0; };
    env['js_window_set_visible']         = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.visible=v!==0; };
    env['js_window_set_arrows_visible']  = (_id: number, _v: number) => { /* no-op */ };
    env['js_window_set_pause']           = (_id: number, _v: number) => { /* no-op */ };
    env['js_window_set_x']               = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.x=v; };
    env['js_window_set_y']               = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.y=v; };
    env['js_window_set_width']           = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.windowWidth=v; };
    env['js_window_set_height']          = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.windowHeight=v; };
    env['js_window_set_z']               = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.z=v; };
    env['js_window_set_ox']              = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.ox=v; };
    env['js_window_set_oy']              = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.oy=v; };
    env['js_window_set_padding']         = (id: number, v: number) => {
      const w = this.windows.get(id);
      if (w) {
        w.padding = v;
        w.redrawWindow();
      }
    };
    env['js_window_set_padding_bottom']  = (id: number, v: number) => {
      const w = this.windows.get(id);
      if (w) {
        w.paddingBottom = v;
        w.redrawWindow();
      }
    };
    env['js_window_set_opacity']         = (id: number, v: number) => { const w=this.windows.get(id); if(w) w.opacity=v; };
    env['js_window_set_back_opacity']    = (id: number, v: number) => {
      const w = this.windows.get(id);
      if (w) {
        w.backOpacity = v;
        w.redrawWindow();
      }
    };
    env['js_window_set_contents_opacity']= (id: number, v: number) => { const w=this.windows.get(id); if(w) w.contentsOpacity=v; };
    env['js_window_set_openness']        = (id: number, v: number) => {
      const w = this.windows.get(id); if (w) w.openness = v;
    };
    env['js_window_set_tone'] = (id: number, r: number, g: number, b: number, gray: number) => {
      const w = this.windows.get(id);
      if (w) w.tone = new Tone(r, g, b, gray);
    };
    env['js_window_get_x']        = (id: number) => this.windows.get(id)?.x ?? 0;
    env['js_window_get_y']        = (id: number) => this.windows.get(id)?.y ?? 0;
    env['js_window_get_width']    = (id: number) => this.windows.get(id)?.windowWidth ?? 0;
    env['js_window_get_height']   = (id: number) => this.windows.get(id)?.windowHeight ?? 0;
    env['js_window_get_openness'] = (id: number) => this.windows.get(id)?.openness ?? 255;

    /* --- Table --- */
    env['js_table_create'] = (x: number, y: number, z: number) => {
      const t = new Table(x, Math.max(y, 1), Math.max(z, 1));
      return this.tables.add(t);
    };
    env['js_table_dispose'] = (id: number) => this.tables.delete(id);
    env['js_table_resize']  = (id: number, x: number, y: number, z: number) => {
      const t = this.tables.get(id);
      if (t) t.resize(x, y, z);
    };
    env['js_table_get'] = (id: number, x: number, y: number, z: number) =>
      this.tables.get(id)?.get(x, y, z) ?? 0;
    env['js_table_set'] = (id: number, x: number, y: number, z: number, val: number) => {
      const t = this.tables.get(id);
      if (t) t.set(x, y, z, val);
    };
    env['js_table_xsize'] = (id: number) => this.tables.get(id)?.xsize ?? 0;
    env['js_table_ysize'] = (id: number) => this.tables.get(id)?.ysize ?? 0;
    env['js_table_zsize'] = (id: number) => this.tables.get(id)?.zsize ?? 0;

    /* --- 파일 시스템 --- */
    const RGSS_EXTS = ['.rvdata2', '.rvdata', '.rxdata'];
    const SAVE_STORAGE_PREFIX = 'wscp_rgss_save_';

    const isSavePath = (p: string): boolean =>
      /^Save\d+\.rvdata2$/i.test(p.replace(/\\/g, '/').replace(/^\/+/, ''));

    const saveStorageKey = (path: string): string =>
      SAVE_STORAGE_PREFIX + path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

    env['js_file_exists'] = (pathPtr: number) => {
      const path = this.readStr(pathPtr).replace(/\\/g, '/');
      if (isSavePath(path)) {
        try {
          return typeof localStorage !== 'undefined' && localStorage.getItem(saveStorageKey(path)) != null ? 1 : 0;
        } catch {
          return 0;
        }
      }
      const candidates = this.buildFileReadPathCandidates(path);
      const files = this.loader.listFiles();
      const norm = (p: string) => p.toLowerCase();
      for (const c of candidates) {
        if (files.some((f) => norm(f) === norm(c))) return 1;
      }
      return 0;
    };
    env['js_file_read'] = (pathPtr: number, outPtrPtr: number, outLenPtr: number): number => {
      const rawPath = this.readStr(pathPtr);
      const path = rawPath.replace(/\\/g, '/');
      let data: Uint8Array | undefined;
      let matchedPath: string | undefined;

      // 세이브 파일: localStorage에서 로드 (게임 계속하기 지원)
      if (isSavePath(path)) {
        try {
          const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(saveStorageKey(path)) : null;
          if (stored) {
            const binary = atob(stored);
            data = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
            matchedPath = `${path} (localStorage)`;
          }
        } catch {
          // ignore
        }
      }

      if (!data) {
        const pathsToTry = this.buildFileReadPathCandidates(path);
        const isRvdata = /\.(?:rvdata2?|rxdata)$/i.test(path) ||
          pathsToTry.some((p) => /\.(?:rvdata2?|rxdata)$/i.test(p));

        // rvdata 계열: JSON 캐시 우선 (mruby에 Marshal 없으므로 JS에서 미리 변환한 JSON 사용)
        if (isRvdata) {
          for (const p of pathsToTry) {
            const normKey = p.toLowerCase();
            data = this.jsonCache.get(normKey);
            if (data) { matchedPath = `${p} (json)`; break; }
          }
        }

        // JSON 캐시 미스 시 원시 바이트 캐시에서 조회
        if (!data) {
          for (const p of pathsToTry) {
            const normKey = p.toLowerCase();
            data = this.fileCache.get(normKey)?.data;
            if (data) { matchedPath = p; break; }
          }
        }
      }

      if (!data || !this._mem) {
        const cachedKeys = [...this.fileCache.keys()].filter((k) => k.startsWith('data/')).slice(0, 15);
        const candidates = this.buildFileReadPathCandidates(path);
        console.error(
          '[js_file_read] load_data 실패 — 파일을 찾을 수 없음:',
          rawPath,
          '\n  후보 경로:', candidates,
          '\n  fileCache:', this.fileCache.size,
          '| jsonCache:', this.jsonCache.size,
          '| loader.listFiles:', this.loader.listFiles().length,
          '\n  캐시 Data 샘플:', cachedKeys,
        );
        this._lastFileReadFailPath = rawPath;
        this._recentFileReadFails.push(rawPath);
        if (this._recentFileReadFails.length > 10) this._recentFileReadFails.shift();
        return 0;
      }
      this._lastFileReadFailPath = null;
      console.debug('[js_file_read] 성공:', rawPath, '→', matchedPath, data.length, 'bytes');
      try {
        const heap32 = this._mem.HEAP32;
        const [ptr] = this._mem.allocBytes(data);
        if (heap32) {
          heap32[outPtrPtr >> 2] = ptr;
          heap32[outLenPtr >> 2] = data.length;
          return 1;
        }
        this._mem.freeBytes(ptr);
        console.error('[js_file_read] HEAP32 없음 — WASM 메모리 미초기화');
      } catch (err) {
        console.error('[js_file_read] allocBytes/쓰기 예외:', rawPath, err instanceof Error ? err.message : String(err));
      }
      return 0;
    };
    env['js_file_free'] = (ptr: number) => {
      if (this._mem) this._mem.freeBytes(ptr);
    };

    /** 세이브 파일 쓰기: C 쪽에서 호출 시 localStorage에 저장 (게임 저장 지원) */
    env['js_file_write'] = (pathPtr: number, dataPtr: number, dataLen: number): number => {
      const path = this.readStr(pathPtr).replace(/\\/g, '/');
      if (!isSavePath(path) || !this._mem || dataLen <= 0) return 0;
      try {
        const bytes = this._mem.readBytes(dataPtr, dataLen);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(saveStorageKey(path), btoa(binary));
          localStorage.setItem(saveStorageKey(path) + '_mtime', String(Date.now()));
        }
        return 1;
      } catch {
        return 0;
      }
    };

    /** 세이브 파일 삭제: File.delete용 */
    env['js_file_delete'] = (pathPtr: number): number => {
      const path = this.readStr(pathPtr).replace(/\\/g, '/');
      if (!isSavePath(path)) return 0;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(saveStorageKey(path));
        }
        return 1;
      } catch {
        return 0;
      }
    };

    /** 세이브 파일 mtime(ms): File.mtime용. 0이면 Time.at(0)에 해당. */
    env['js_file_mtime'] = (pathPtr: number): number => {
      const path = this.readStr(pathPtr).replace(/\\/g, '/');
      if (!isSavePath(path)) return 0;
      try {
        const metaKey = saveStorageKey(path) + '_mtime';
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(metaKey) : null;
        return stored ? parseInt(stored, 10) : 0;
      } catch {
        return 0;
      }
    };

    /** Dir.glob("Save*.rvdata2")용. 반환: 파일명들을 \\n으로 연결한 문자열 포인터(0=실패). */
    env['js_dir_glob'] = (patternPtr: number): number => {
      const pattern = this.readStr(patternPtr).replace(/\\/g, '/');
      if (!/^Save\*\.rvdata2$/i.test(pattern)) return 0;
      try {
        const keys: string[] = [];
        if (typeof localStorage !== 'undefined') {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(SAVE_STORAGE_PREFIX) && !k.endsWith('_mtime')) {
              const name = k.slice(SAVE_STORAGE_PREFIX.length);
              if (/^save\d+\.rvdata2$/i.test(name)) keys.push(name);
            }
          }
        }
        const joined = keys.sort().join('\n');
        if (!this._mem) return 0;
        const enc = new TextEncoder().encode(joined + '\0');
        const [ptr] = this._mem.allocBytes(enc);
        return ptr;
      } catch {
        return 0;
      }
    };

    /* --- Regexp (JS RegExp 브릿지) --- */
    const regexpRegistry = new Map<number, RegExp>();
    let regexpNextId = 1;
    let lastMatchResult: RegExpExecArray | null = null;
    env['js_regexp_create'] = (patternPtr: number, flags: number) => {
      const pattern = this.readStr(patternPtr);
      const f: string[] = [];
      if (flags & 1) f.push('i');
      if (flags & 4) f.push('m');
      try {
        const re = new RegExp(pattern, [...f, 'd'].join(''));
        regexpRegistry.set(regexpNextId, re);
        return regexpNextId++;
      } catch {
        try {
          const re = new RegExp(pattern, f.join(''));
          regexpRegistry.set(regexpNextId, re);
          return regexpNextId++;
        } catch {
          return 0;
        }
      }
    };
    env['js_regexp_dispose'] = (id: number) => regexpRegistry.delete(id);
    env['js_regexp_exec'] = (id: number, strPtr: number) => {
      const re = regexpRegistry.get(id);
      if (!re) return 0;
      const str = this.readStr(strPtr);
      lastMatchResult = re.exec(str);
      return lastMatchResult ? 1 : 0;
    };
    env['js_regexp_match_start'] = () =>
      lastMatchResult?.indices?.[0]?.[0] ?? lastMatchResult?.index ?? 0;
    env['js_regexp_match_end'] = () => {
      if (lastMatchResult?.indices?.[0]) return lastMatchResult.indices[0][1];
      if (lastMatchResult) return lastMatchResult.index + (lastMatchResult[0]?.length ?? 0);
      return 0;
    };
    env['js_regexp_capture_count'] = () =>
      Math.max(0, (lastMatchResult?.length ?? 1) - 1);
    env['js_regexp_capture_start'] = (_id: number, idx: number) =>
      lastMatchResult?.indices?.[idx]?.[0] ?? -1;
    env['js_regexp_capture_end'] = (_id: number, idx: number) =>
      lastMatchResult?.indices?.[idx]?.[1] ?? -1;
    env['js_regexp_set_last_match'] = () => {};

    /* --- 시스템 --- */
    env['js_msgbox'] = (msgPtr: number) => {
      /* 빈/무효 포인터 시 즉시 반환 — readStr 호출 없이 종료하여 무한 대기 방지 */
      if (msgPtr == null || msgPtr === 0 || typeof msgPtr !== 'number') {
        console.debug('[RGSS msgbox] suppressed: invalid ptr', msgPtr);
        return;
      }
      let msg: string;
      try {
        msg = this.readStr(msgPtr);
      } catch (e) {
        console.warn('[RGSS msgbox] readStr failed:', e);
        return;
      }
      /* C 진단 메시지는 항상 로그 (wrgss_tick/rb_rgss_main 조기 반환) */
      if (msg.startsWith('wrgss_tick:') || msg.startsWith('rb_rgss_main:')) {
        console.warn('[RGSS msgbox] [C diagnostic]', msg);
      }
      if (msg.includes('cannot open file')) {
        const failPath = this._lastFileReadFailPath;
        if (failPath) {
          msg = `${msg}\n\n파일: ${failPath}`;
          this._lastFileReadFailPath = null;
        }
        if (this._recentFileReadFails.length > 0) {
          msg = `${msg}\n최근 실패 경로: ${this._recentFileReadFails.join(', ')}`;
        }
      }
      // 빈 msg만 suppress. 인자 오류/런타임 오류는 디버깅을 위해 반드시 노출.
      if (!msg.trim()) {
        console.debug('[RGSS msgbox] suppressed: empty');
        return;
      }
      const scriptErrorMatch = msg.match(/\[RGSS Script Error\]\s*\[(\d+)\]\s*(.+?)(?:\n|$)/);
      if (scriptErrorMatch) {
        const [, index, title] = scriptErrorMatch;
        const firstLine = msg.split('\n')[0] ?? msg;
        console.warn(`[RGSS] Script ${index} (${title.trim()}):`, firstLine);
      } else {
        console.warn('[RGSS msgbox]', msg);
      }
      this._onMsgbox?.(msg);
    };
    env['js_rgss_stop'] = () => {
      this._onRgssStop?.();
    };
    env['js_get_time_ms'] = () => performance.now();
    /** Time.at(sec) — Unix 초를 ms로 변환. C에서 Time 객체 생성 시 사용. */
    env['js_time_at'] = (sec: number) => Math.floor(sec * 1000);

    return { env };
  }

  /* ====================================================
   * 내부 헬퍼
   * ==================================================== */
  private _mem: import('./WasmMemory').WasmMemory | null = null;
  private _onMsgbox?: (msg: string) => void;
  private _onRgssStop?: () => void;
  /** load_data 실패 시 마지막으로 시도한 경로 (msgbox에 파일명 명시용) */
  private _lastFileReadFailPath: string | null = null;
  /** 최근 file_read 실패 경로 목록 (디버깅용, 최대 10개 유지) */
  private _recentFileReadFails: string[] = [];

  /** WasmMemory 인스턴스를 주입한다 (모듈 로드 후 호출). */
  setMemory(mem: import('./WasmMemory').WasmMemory): void {
    this._mem = mem;
  }

  setCallbacks(opts: { onMsgbox?: (msg: string) => void; onRgssStop?: () => void }): void {
    this._onMsgbox = opts.onMsgbox;
    this._onRgssStop = opts.onRgssStop;
  }

  /** 파일을 미리 캐시에 적재한다 (게임 로드 시점에 일괄 로드). */
  async preloadFile(path: string): Promise<void> {
    try {
      const data = await this.loader.getFile(path);
      if (data) {
        // js_file_read 조회와 동일한 키 형식. FS illegal path 방지를 위해 sanitize 적용
        const normKey = sanitizeFsPath(path).replace(/\\/g, '/').toLowerCase();
        this.fileCache.set(normKey, { data });
      }
    } catch {
      /* 조용히 무시 */
    }
  }

  async preloadAll(): Promise<void> {
    const loaderMaybeBulk = this.loader as IResourceLoader & {
      preloadBulk?: (maxBytes?: number) => Promise<boolean>;
    };
    if (typeof loaderMaybeBulk.preloadBulk === 'function') {
      const ok = await loaderMaybeBulk.preloadBulk();
      if (ok) {
        const files = this.loader.listFiles();
        await Promise.all(files.map((f) => this.preloadFile(f)));
        this.convertRvdataToJson();
        console.log(
          `[WasmRgssBridge] preloadAll (bulk): ${files.length}개 파일 → 캐시 ${this.fileCache.size}개, JSON ${this.jsonCache.size}개`,
          '\n  Data 파일:', [...this.fileCache.keys()].filter((k) => k.startsWith('data/')).slice(0, 15),
        );
        return;
      }
    }
    const files = this.loader.listFiles();
    await Promise.all(files.map((f) => this.preloadFile(f)));
    this.convertRvdataToJson();
    console.log(
      `[WasmRgssBridge] preloadAll (individual): ${files.length}개 파일 → 캐시 ${this.fileCache.size}개, JSON ${this.jsonCache.size}개`,
      '\n  Data 파일:', [...this.fileCache.keys()].filter((k) => k.startsWith('data/')).slice(0, 15),
    );
  }

  /**
   * fileCache 내 rvdata2/rvdata/rxdata 파일을 JS Marshal 파서로 역직렬화 → JSON 바이트로 변환.
   * mruby에는 Marshal 모듈이 없으므로, load_data가 JSON.parse로 동작하게 하기 위함.
   * Scripts.rvdata2는 이미 번들러가 처리하므로 제외.
   */
  private convertRvdataToJson(): void {
    const RVDATA_RE = /\.(?:rvdata2?|rxdata)$/i;
    let converted = 0;
    let failed = 0;
    for (const [key, entry] of this.fileCache) {
      if (!RVDATA_RE.test(key)) continue;
      if (key.includes('scripts')) continue;
      try {
        const obj = decodeRubyMarshalToJs(entry.data);
        const json = JSON.stringify(obj);
        this.jsonCache.set(key, new TextEncoder().encode(json));
        converted++;
      } catch (err) {
        failed++;
        console.warn(`[WasmRgssBridge] rvdata→JSON 변환 실패: ${key}`, err);
      }
    }
    if (converted > 0 || failed > 0) {
      console.log(`[WasmRgssBridge] rvdata→JSON 변환: ${converted}개 성공, ${failed}개 실패`);
    }
  }

  private readStr(ptr: number): string {
    return this._mem?.readStr(ptr) ?? '';
  }

  /**
   * load_data / js_file_read용 경로 후보 생성.
   * RGSS는 "Data/Map001.rvdata2", "Map001", "Data\\Map001" 등 다양한 형식으로 요청할 수 있음.
   * Data/ 접두사 보정, 확장자 후보, 절대경로에서 Data/ 이하만 추출.
   */
  private buildFileReadPathCandidates(path: string): string[] {
    const RGSS_EXTS = ['.rvdata2', '.rvdata', '.rxdata'];
    const out: string[] = [];
    const normalized = sanitizeFsPath(path).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    const withExt = normalized.includes('.') ? [normalized] : [normalized, ...RGSS_EXTS.map((e) => normalized + e)];
    for (const p of withExt) {
      if (p && !out.includes(p)) out.push(p);
      const dataRelative = p.includes('Data/') ? p.replace(/^.*\/Data\//i, 'Data/') : (p.startsWith('Data/') ? p : `Data/${p}`);
      if (dataRelative && dataRelative !== p && !out.includes(dataRelative)) out.push(dataRelative);
    }
    if (!normalized.toLowerCase().startsWith('data/')) {
      for (const e of RGSS_EXTS) {
        const withData = `Data/${normalized}${normalized.includes('.') ? '' : e}`;
        if (!out.includes(withData)) out.push(withData);
      }
    }
    return out.length ? out : [path];
  }
}

/* ====================================================
 * Input 코드 → 심볼 매핑
 * C 쪽 input_sym_to_int와 대칭
 * ==================================================== */
function codeToSym(code: number): string {
  const map: Record<number, string> = {
    2: 'DOWN', 4: 'LEFT', 6: 'RIGHT', 8: 'UP',
    11: 'A', 12: 'B', 13: 'C', 14: 'X', 15: 'Y', 16: 'Z',
    17: 'L', 18: 'R',
    21: 'SHIFT', 22: 'CTRL', 23: 'ALT',
    25: 'F5', 26: 'F6', 27: 'F7', 28: 'F8', 29: 'F9',
  };
  return map[code] ?? '';
}
