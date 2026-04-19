# webrgss_prelude.rb
#
# Runs immediately after wrgss_init() registers all native classes.
# Compiled to a RITE bytecode blob (wrgss_prelude_irep) and embedded
# inside webrgss.wasm. No external files are loaded.
#
# Responsibilities (minimum to let the JS-side runtime bootstrap run):
#   1) Wrap rgss_main { ... } in a Fiber stored in $__wrgss_main_fiber.
#   2) Define __wrgss_tick_internal to resume that Fiber once per frame.
#   3) Expose __wrgss_rgss_main_orig so WasmRgssRuntime.ts can re-alias.
#   4) Provide WrgssReader / WrgssWriter so File.open's block-form works.
#   5) Intercept Tilemap#bitmaps[] = bmp to call native setter.
#   6) Install Font proxy on Bitmap so `bitmap.font.size = N` works.

# ----------------------------------------------------------------
# Main loop Fiber
# ----------------------------------------------------------------

$__wrgss_main_fiber = nil

# Save the native rgss_main (defined in rgss_data.c) so scripts/WasmRgssRuntime
# can restore it via `alias rgss_main __wrgss_rgss_main_orig` after its own
# bootstrap finishes.
alias __wrgss_rgss_main_orig rgss_main

def rgss_main(&block)
  return unless block
  $__wrgss_main_fiber = Fiber.new do
    begin
      block.call
    rescue => err
      hdr = "[rgss_main] #{err.class}: #{err.message}"
      if err.respond_to?(:backtrace) && err.backtrace
        hdr << "\n" << err.backtrace.join("\n")
      end
      msgbox(hdr)
    end
    nil
  end
end

# Called from C wrgss_tick() every frame.
# Returns 1 while the fiber is alive, 0 when it has finished.
def __wrgss_tick_internal
  fiber = $__wrgss_main_fiber
  return 0 if fiber.nil?
  return 0 unless fiber.alive?
  begin
    fiber.resume
  rescue FiberError
    $__wrgss_main_fiber = nil
    return 0
  rescue => err
    hdr = "[wrgss_tick] #{err.class}: #{err.message}"
    msgbox(hdr)
    $__wrgss_main_fiber = nil
    return 0
  end
  fiber.alive? ? 1 : 0
end

# ----------------------------------------------------------------
# File.open block adapters
# ----------------------------------------------------------------

class WrgssReader
  def initialize(data)
    @data = data.to_s
    @pos  = 0
  end
  def read(n = nil)
    return nil if @pos >= @data.length
    if n.nil?
      r = @data[@pos, @data.length - @pos]
      @pos = @data.length
    else
      r = @data[@pos, n]
      @pos += r.length
    end
    r
  end
  def eof?;   @pos >= @data.length; end
  def close;  self; end
  def binmode; self; end
  def path; "(wrgss)"; end
end

class WrgssWriter
  def initialize(buffer)
    @buffer = buffer
  end
  def write(s)
    @buffer << s.to_s
    s.to_s.length
  end
  def puts(*args)
    args.each { |a| @buffer << a.to_s << "\n" }
    nil
  end
  def print(*args)
    args.each { |a| @buffer << a.to_s }
    nil
  end
  def close;   self; end
  def binmode; self; end
end

# ----------------------------------------------------------------
# Tilemap#bitmaps[] = bmp interception
# ----------------------------------------------------------------

class Tilemap
  class BitmapsProxy < Array
    def initialize(owner)
      super()
      @owner = owner
    end
    def []=(index, bitmap)
      super
      @owner.__wrgss_tilemap_set_bitmap(index, bitmap) if @owner.respond_to?(:__wrgss_tilemap_set_bitmap)
      bitmap
    end
  end

  alias __wrgss_bitmaps_native bitmaps

  def bitmaps
    proxy = instance_variable_get(:@__wrgss_bitmaps_proxy)
    if proxy.nil?
      proxy = BitmapsProxy.new(self)
      native = __wrgss_bitmaps_native rescue nil
      if native.is_a?(Array)
        native.each_index { |i| proxy[i] = native[i] }
      end
      instance_variable_set(:@__wrgss_bitmaps_proxy, proxy)
    end
    proxy
  end
end

# ----------------------------------------------------------------
# Bitmap font proxy — bitmap.font.size = N etc. drive js_bitmap_set_font_*.
#
# The native Bitmap class stores the Font object in @font (simple ivar).
# Game code reads bitmap.font (returns Font), mutates font.size/color/...,
# and expects the change to take effect. We accomplish this with a tiny
# Font subclass that replays writes onto the bitmap via __wrgss_font_*=.
# ----------------------------------------------------------------

class WrgssAttachedFont < Font
  def initialize(bitmap, base = nil)
    super()
    @__wrgss_bitmap = bitmap
    if base
      self.name    = base.name    rescue nil
      self.size    = base.size    rescue nil
      self.bold    = base.bold    rescue nil
      self.italic  = base.italic  rescue nil
      self.shadow  = base.shadow  rescue nil
      self.outline = base.outline rescue nil
      self.color   = base.color   rescue nil
      self.out_color = base.out_color rescue nil
    end
  end
  def name=(v);    super; @__wrgss_bitmap.__wrgss_font_name    = v.to_s if v; v; end
  def size=(v);    super; @__wrgss_bitmap.__wrgss_font_size    = v.to_i if v; v; end
  def bold=(v);    super; @__wrgss_bitmap.__wrgss_font_bold    = v; v; end
  def italic=(v);  super; @__wrgss_bitmap.__wrgss_font_italic  = v; v; end
  def shadow=(v);  super; @__wrgss_bitmap.__wrgss_font_shadow  = v; v; end
  def outline=(v); super; @__wrgss_bitmap.__wrgss_font_outline = v; v; end
  def color=(v)
    super
    @__wrgss_bitmap.__wrgss_font_color = v if v
    v
  end
  def out_color=(v)
    super
    @__wrgss_bitmap.__wrgss_font_out_color = v if v
    v
  end
end

class Bitmap
  alias __wrgss_font_get_c font
  alias __wrgss_font_set_c font=

  def font
    f = __wrgss_font_get_c
    if f.nil?
      f = WrgssAttachedFont.new(self)
      __wrgss_font_set_c(f)
    elsif !f.is_a?(WrgssAttachedFont)
      f = WrgssAttachedFont.new(self, f)
      __wrgss_font_set_c(f)
    end
    f
  end

  def font=(v)
    if v.nil?
      __wrgss_font_set_c(WrgssAttachedFont.new(self))
    elsif v.is_a?(WrgssAttachedFont)
      __wrgss_font_set_c(v)
    else
      __wrgss_font_set_c(WrgssAttachedFont.new(self, v))
    end
    v
  end
end

# ----------------------------------------------------------------
# Misc. compatibility shims used before the JS bootstrap runs.
# ----------------------------------------------------------------

# Kernel#print that routes through msgbox is annoying for development, so we
# funnel Kernel#puts through it instead.
module Kernel
  alias __wrgss_puts_orig puts rescue nil
  def puts(*args)
    if args.empty?
      msgbox("")
    else
      args.each { |a| msgbox(a.to_s) }
    end
    nil
  end
end
