/**
 * TitleScene - 타이틀 화면 (System.rvdata2 기반)
 * zip 리소스에서 타이틀 이미지/BGM 로드 후 표시
 */
import { Bitmap } from '../api/Bitmap';
import { Sprite } from '../api/Sprite';
import { Graphics } from '../api/Graphics';
import { Audio } from '../api/Audio';
import { Input, InputState } from '../api/Input';
import { Window as RGSSWindow } from '../api/Window';
import { normalizeRPGSystem, type RPGSystem } from '../rpg';
import type { IResourceResolver } from '../resources/types';

const TITLE_COMMANDS = ['New Game', 'Continue', 'Shutdown'] as const;

class TitleCommandWindow extends RGSSWindow {
  private index = 0;
  private confirmFlashFrames = 0;
  private readonly rowTop = 6;
  private readonly rowHeight = 24;
  private readonly onMove?: (index: number) => void;
  private readonly onConfirm?: (index: number, label: string) => void;

  constructor(
    x: number,
    y: number,
    width: number,
    height: number,
    opts?: {
      onMove?: (index: number) => void;
      onConfirm?: (index: number, label: string) => void;
    }
  ) {
    super(x, y, width, height);
    this.onMove = opts?.onMove;
    this.onConfirm = opts?.onConfirm;
    this.backOpacity = 212;
    this.redrawWindow();
    this.redrawContents();
    this.updateCursor();
  }

  override update(): void {
    super.update();

    if (InputState.repeat(Input.DOWN)) {
      this.moveSelection(1);
    } else if (InputState.repeat(Input.UP)) {
      this.moveSelection(-1);
    }

    if (InputState.trigger(Input.C)) {
      this.confirmFlashFrames = 8;
      const label = TITLE_COMMANDS[this.index] ?? '';
      this.onConfirm?.(this.index, label);
    }

    if (this.confirmFlashFrames > 0) {
      this.confirmFlashFrames -= 1;
      this.contentsOpacity = this.confirmFlashFrames % 2 === 0 ? 255 : 208;
    } else {
      this.contentsOpacity = 255;
    }
  }

  private moveSelection(delta: number): void {
    const len = TITLE_COMMANDS.length;
    const next = (this.index + delta + len) % len;
    if (next === this.index) return;
    this.index = next;
    this.updateCursor();
    this.onMove?.(this.index);
  }

  private updateCursor(): void {
    this.setCursorRect(4, this.rowTop + this.index * this.rowHeight, this.contents.width - 8, 24);
  }

  private redrawContents(): void {
    this.clearContents();
    this.contents.font.size = 18;
    this.contents.font.bold = false;
    this.contents.font.color = { red: 255, green: 255, blue: 255, alpha: 255 };
    for (let i = 0; i < TITLE_COMMANDS.length; i += 1) {
      this.contents.drawText(
        0,
        this.rowTop + i * this.rowHeight,
        this.contents.width,
        24,
        TITLE_COMMANDS[i],
        1
      );
    }
  }

  getRowTop(): number {
    return this.rowTop;
  }

  getRowHeight(): number {
    return this.rowHeight;
  }
}

class PulseSprite extends Sprite {
  private frame = 0;
  private readonly baseOpacity: number;
  private readonly amplitude: number;
  private readonly speed: number;

  constructor(baseOpacity = 220, amplitude = 35, speed = 0.12) {
    super();
    this.baseOpacity = baseOpacity;
    this.amplitude = amplitude;
    this.speed = speed;
  }

  override update(): void {
    this.frame += 1;
    this.opacity = Math.max(
      80,
      Math.min(255, Math.round(this.baseOpacity + Math.sin(this.frame * this.speed) * this.amplitude))
    );
  }
}

export class TitleScene {
  private loader: IResourceResolver;
  private system: RPGSystem | null = null;
  private sprites: Sprite[] = [];
  private bgSprite: Sprite | null = null;

  constructor(loader: IResourceResolver) {
    this.loader = loader;
  }

  setSystem(data: unknown): void {
    this.system = normalizeRPGSystem(data);
    if (!this.system?.title1_name && !this.system?.title2_name) {
      console.warn("[WebRGSS][TitleScene] System title metadata missing; using title-folder fallback");
    }
  }

  async load(): Promise<void> {
    const bgName = this.system?.title1_name || '';
    let bgLoaded = false;
    if (bgName) {
      const paths = [
        `Graphics/Titles1/${bgName}`,
        `Graphics/Titles/${bgName}`,
        `Graphics/${bgName}`,
        bgName,
      ];
      for (const p of paths) {
        const url = await this.loader.getImageUrl(p);
        if (url) {
          try {
            const bmp = await Bitmap.load(url);
            const spr = this.createSprite(bmp, 0);
            this.bgSprite = spr;
            this.sprites.push(spr);
            bgLoaded = true;
          } catch {
            // 로드 실패 시 다음 경로 시도
          }
          break;
        }
      }
    }

    const fgName = this.system?.title2_name || '';
    if (fgName && fgName !== bgName) {
      const paths = [
        `Graphics/Titles2/${fgName}`,
        `Graphics/Titles/${fgName}`,
        `Graphics/${fgName}`,
        fgName,
      ];
      for (const p of paths) {
        const url = await this.loader.getImageUrl(p);
        if (url) {
          try {
            const bmp = await Bitmap.load(url);
            this.sprites.push(this.createSprite(bmp, 1));
          } catch {
            // 무시
          }
          break;
        }
      }
    }

    // System에서 못 찾았으면 단계별 폴백:
    // - 타이틀 계열 폴더를 먼저 "개별" 조회해서 RTP 타이틀 자산이
    //   게임 ZIP의 Parallaxes/Pictures보다 먼저 선택되도록 한다.
    //   (RtpBackedResourceLoader는 game -> rtp 순서로 찾기 때문)
    if (!bgLoaded) {
      const fallbackStages = [
        ['graphics/titles1'],
        ['graphics/titles2'],
        ['graphics/titles'],
        ['graphics/pictures'],
        ['graphics/parallaxes'],
      ] as const;

      let firstPath: string | null = null;
      for (const stage of fallbackStages) {
        firstPath = this.loader.findFirstImage([...stage]);
        if (firstPath) break;
      }

      if (firstPath) {
        const url = await this.loader.getImageUrl(firstPath);
        if (url) {
          try {
            const bmp = await Bitmap.load(url);
            const spr = this.createSprite(bmp, 0);
            this.bgSprite = spr;
            this.sprites.push(spr);
            bgLoaded = true;
          } catch (err) {
            throw new Error(
              `타이틀 이미지 로드 실패: ${firstPath}\n${err instanceof Error ? err.message : String(err)}`
            );
          }
        } else {
          throw new Error(
            `타이틀 이미지를 찾을 수 없습니다. (경로: ${firstPath})`
          );
        }
      } else {
        throw new Error(
          '타이틀 이미지를 찾을 수 없습니다. Graphics/Titles1 또는 Graphics/Titles2 이미지가 있는지 확인하세요.'
        );
      }
    }

    this.buildTitleUi();
    Graphics.brightness = 0;
    Graphics.fadein(24);

    const bgm = this.system?.title_bgm;
    if (bgm?.name) {
      const paths = [
        `Audio/BGM/${bgm.name}`,
        `Audio/bgm/${bgm.name}`,
        bgm.name,
      ];
      for (const p of paths) {
        const url = await this.loader.getAudioUrl(p);
        if (url) {
          void Audio.bgmPlay(p, bgm.volume ?? 100, bgm.pitch ?? 100);
          break;
        }
      }
    }
  }

  private buildTitleUi(): void {
    const uiWidth = Graphics.width;
    const uiHeight = Graphics.height;
    const titleLabel = this.system?.game_title?.trim() || "RPG Maker VX Ace";
    const shouldDrawTitle = this.system?.opt_draw_title !== false;

    if (shouldDrawTitle) {
      const titleBmp = new Bitmap(uiWidth, 56);
      titleBmp.font.size = 30;
      titleBmp.font.bold = true;
      titleBmp.drawText(0, 8, uiWidth, 36, titleLabel, 1);

      const titleSpr = new Sprite();
      titleSpr.bitmap = titleBmp;
      titleSpr.y = 22;
      titleSpr.z = 10;
      this.sprites.push(titleSpr);
    }

    const panelW = 220;
    const panelH = 96;
    const panelX = Math.floor((uiWidth - panelW) / 2);
    const panelY = uiHeight - panelH - 34;

    const caretBmp = new Bitmap(18, 20);
    caretBmp.font.size = 16;
    caretBmp.drawText(0, 0, 18, 20, ">", 0);
    const caretSpr = new PulseSprite();
    caretSpr.bitmap = caretBmp;
    caretSpr.x = panelX + 22;
    caretSpr.z = 12;
    this.sprites.push(caretSpr);

    const commandWindow = new TitleCommandWindow(panelX, panelY, panelW, panelH, {
      onMove: (index) => {
        caretSpr.y = panelY + 12 + commandWindow.getRowTop() + index * commandWindow.getRowHeight() + 2;
      },
      onConfirm: (index, label) => {
        console.info(`[WebRGSS][TitleScene] command selected: ${index}:${label}`);
      },
    });
    commandWindow.z = 11;
    this.sprites.push(commandWindow);
    caretSpr.y = panelY + 12 + commandWindow.getRowTop() + 2;
  }

  private createSprite(bmp: Bitmap, z: number): Sprite {
    const spr = new Sprite();
    spr.bitmap = bmp;
    spr.srcRect.x = 0;
    spr.srcRect.y = 0;
    spr.srcRect.width = bmp.width;
    spr.srcRect.height = bmp.height;
    spr.z = z;

    const gw = Graphics.width;
    const gh = Graphics.height;
    if (bmp.width <= 0 || bmp.height <= 0) return spr;

    // 이미지 정가운데를 기준점(ox, oy)으로, 화면 정가운데에 배치
    spr.ox = bmp.width / 2;
    spr.oy = bmp.height / 2;
    spr.x = gw / 2;
    spr.y = gh / 2;

    // 544x416이 아닐 때 화면에 맞게 스케일 (cover)
    if (bmp.width !== gw || bmp.height !== gh) {
      const scale = Math.max(gw / bmp.width, gh / bmp.height);
      spr.zoomX = scale;
      spr.zoomY = scale;
    }
    return spr;
  }

  getSprites(): Sprite[] {
    return this.sprites;
  }
}
