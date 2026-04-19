/**
 * Table - RGSS 다차원 배열 (맵 타일 데이터 등)
 * 참조: webrgss/table.rb, vscode-rgss-script-compiler RGSS3/modules/Table.rb
 */
export class Table {
  xsize: number;
  ysize: number;
  zsize: number;
  private _data: number[];

  constructor(x: number, y = 0, z = 0) {
    const dim = 1 + (y > 0 ? 1 : 0) + (z > 0 ? 1 : 0);
    this.xsize = x;
    this.ysize = Math.max(y, 1);
    this.zsize = Math.max(z, 1);
    this._data = Array(this.xsize * this.ysize * this.zsize).fill(0);
  }

  get(x: number, y = 0, z = 0): number {
    return this._data[x + y * this.xsize + z * this.xsize * this.ysize] ?? 0;
  }

  set(x: number, v: number): void;
  set(x: number, y: number, v: number): void;
  set(x: number, y: number, z: number, v: number): void;
  set(x: number, yOrV?: number, zOrV?: number, v?: number): void {
    let y = 0;
    let z = 0;
    let val: number;
    if (v !== undefined) {
      y = yOrV ?? 0;
      z = zOrV ?? 0;
      val = v;
    } else if (zOrV !== undefined) {
      y = yOrV ?? 0;
      val = zOrV;
    } else {
      val = yOrV ?? 0;
    }
    const idx = x + y * this.xsize + z * this.xsize * this.ysize;
    if (idx >= 0 && idx < this._data.length) {
      this._data[idx] = val;
    }
  }

  get data(): number[] {
    return this._data;
  }

  set data(arr: number[]) {
    this._data = arr;
  }

  /**
   * Table#resize — mkxp table.cpp resize() 참고.
   * x, y, z 크기 변경. 기존 데이터는 유지, 새 영역은 0으로 채움.
   */
  resize(x: number, y: number, z: number): void {
    const nx = Math.max(1, x);
    const ny = Math.max(1, y);
    const nz = Math.max(1, z);
    const newData = Array(nx * ny * nz).fill(0);
    const copyX = Math.min(this.xsize, nx);
    const copyY = Math.min(this.ysize, ny);
    const copyZ = Math.min(this.zsize, nz);
    for (let iz = 0; iz < copyZ; iz++) {
      for (let iy = 0; iy < copyY; iy++) {
        for (let ix = 0; ix < copyX; ix++) {
          const oldIdx = ix + iy * this.xsize + iz * this.xsize * this.ysize;
          const newIdx = ix + iy * nx + iz * nx * ny;
          newData[newIdx] = this._data[oldIdx];
        }
      }
    }
    this.xsize = nx;
    this.ysize = ny;
    this.zsize = nz;
    this._data = newData;
  }
}
