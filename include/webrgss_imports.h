/*
 * webrgss_imports.h — extern declarations for every js_* function the C
 *                     runtime imports from the host JavaScript environment.
 *
 * ALL of these must match the signatures implemented by
 * application/wscp-frontend/lib/webrgss/wasm/WasmRgssBridge.ts#buildImports().
 *
 * Conventions:
 *   - All IDs are i32. 0 == invalid / missing.
 *   - All Ruby strings cross the boundary as zero-terminated UTF-8 pointers,
 *     allocated via mrb_str_cstr() (stable for the call's duration).
 *   - Functions that need to allocate host-side buffers and hand a pointer
 *     back (js_dir_glob, js_file_read) explicitly document ownership.
 */
#ifndef WEBRGSS_IMPORTS_H
#define WEBRGSS_IMPORTS_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define WRGSS_IMPORT __attribute__((import_module("env")))

/* ---------- Graphics ---------- */
WRGSS_IMPORT void     js_graphics_update(void);
WRGSS_IMPORT void     js_graphics_wait(int32_t duration);
WRGSS_IMPORT void     js_graphics_fadeout(int32_t duration);
WRGSS_IMPORT void     js_graphics_fadein(int32_t duration);
WRGSS_IMPORT void     js_graphics_freeze(void);
WRGSS_IMPORT void     js_graphics_transition(int32_t duration, const char *filename_or_null, int32_t vague);
WRGSS_IMPORT int32_t  js_graphics_snap_to_bitmap(void);
WRGSS_IMPORT void     js_graphics_frame_reset(void);
WRGSS_IMPORT int32_t  js_graphics_get_width(void);
WRGSS_IMPORT int32_t  js_graphics_get_height(void);
WRGSS_IMPORT void     js_graphics_resize_screen(int32_t w, int32_t h);
WRGSS_IMPORT int32_t  js_graphics_get_frame_rate(void);
WRGSS_IMPORT void     js_graphics_set_frame_rate(int32_t v);
WRGSS_IMPORT int32_t  js_graphics_get_frame_count(void);
WRGSS_IMPORT void     js_graphics_set_frame_count(int32_t v);
WRGSS_IMPORT int32_t  js_graphics_get_brightness(void);
WRGSS_IMPORT void     js_graphics_set_brightness(int32_t v);
WRGSS_IMPORT void     js_graphics_play_movie(const char *path);

/* ---------- Audio ---------- */
WRGSS_IMPORT void     js_audio_bgm_play(const char *name, int32_t volume, int32_t pitch, int32_t pos);
WRGSS_IMPORT void     js_audio_bgm_stop(void);
WRGSS_IMPORT void     js_audio_bgm_fade(int32_t time);
WRGSS_IMPORT int32_t  js_audio_bgm_pos(void);
WRGSS_IMPORT void     js_audio_bgs_play(const char *name, int32_t volume, int32_t pitch, int32_t pos);
WRGSS_IMPORT void     js_audio_bgs_stop(void);
WRGSS_IMPORT void     js_audio_bgs_fade(int32_t time);
WRGSS_IMPORT int32_t  js_audio_bgs_pos(void);
WRGSS_IMPORT void     js_audio_me_play(const char *name, int32_t volume, int32_t pitch);
WRGSS_IMPORT void     js_audio_me_stop(void);
WRGSS_IMPORT void     js_audio_me_fade(int32_t time);
WRGSS_IMPORT void     js_audio_se_play(const char *name, int32_t volume, int32_t pitch);
WRGSS_IMPORT void     js_audio_se_stop(void);

/* ---------- Input ---------- */
WRGSS_IMPORT int32_t  js_input_press(int32_t code);
WRGSS_IMPORT int32_t  js_input_trigger(int32_t code);
WRGSS_IMPORT int32_t  js_input_repeat(int32_t code);
WRGSS_IMPORT int32_t  js_input_dir4(void);
WRGSS_IMPORT int32_t  js_input_dir8(void);

/* ---------- Bitmap ---------- */
WRGSS_IMPORT int32_t  js_bitmap_create(int32_t w, int32_t h);
WRGSS_IMPORT int32_t  js_bitmap_load(const char *path);
WRGSS_IMPORT void     js_bitmap_dispose(int32_t id);
WRGSS_IMPORT int32_t  js_bitmap_clone(int32_t id);
WRGSS_IMPORT int32_t  js_bitmap_width(int32_t id);
WRGSS_IMPORT int32_t  js_bitmap_height(int32_t id);
WRGSS_IMPORT void     js_bitmap_blt(int32_t dst, int32_t dx, int32_t dy,
                                     int32_t src, int32_t sx, int32_t sy, int32_t sw, int32_t sh,
                                     int32_t opacity);
WRGSS_IMPORT void     js_bitmap_stretch_blt(int32_t dst,
                                             int32_t ddx, int32_t ddy, int32_t ddw, int32_t ddh,
                                             int32_t src,
                                             int32_t sx, int32_t sy, int32_t sw, int32_t sh,
                                             int32_t opacity);
WRGSS_IMPORT void     js_bitmap_fill_rect(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h,
                                            int32_t r, int32_t g, int32_t b, int32_t a);
WRGSS_IMPORT void     js_bitmap_gradient_fill_rect(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h,
                                                     int32_t r1, int32_t g1, int32_t b1, int32_t a1,
                                                     int32_t r2, int32_t g2, int32_t b2, int32_t a2,
                                                     int32_t vertical);
WRGSS_IMPORT void     js_bitmap_clear(int32_t id);
WRGSS_IMPORT void     js_bitmap_clear_rect(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h);
WRGSS_IMPORT int32_t  js_bitmap_get_pixel(int32_t id, int32_t x, int32_t y);
WRGSS_IMPORT void     js_bitmap_set_pixel(int32_t id, int32_t x, int32_t y,
                                            int32_t r, int32_t g, int32_t b, int32_t a);
WRGSS_IMPORT void     js_bitmap_hue_change(int32_t id, int32_t hue);
WRGSS_IMPORT void     js_bitmap_blur(int32_t id);
WRGSS_IMPORT void     js_bitmap_radial_blur(int32_t id, int32_t angle, int32_t div);
WRGSS_IMPORT void     js_bitmap_draw_text(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h,
                                            const char *str, int32_t align);
WRGSS_IMPORT void     js_bitmap_text_size(int32_t id, const char *str, int32_t *out_w, int32_t *out_h);
WRGSS_IMPORT void     js_bitmap_set_font_name(int32_t id, const char *name);
WRGSS_IMPORT void     js_bitmap_set_font_size(int32_t id, int32_t size);
WRGSS_IMPORT void     js_bitmap_set_font_bold(int32_t id, int32_t v);
WRGSS_IMPORT void     js_bitmap_set_font_italic(int32_t id, int32_t v);
WRGSS_IMPORT void     js_bitmap_set_font_shadow(int32_t id, int32_t v);
WRGSS_IMPORT void     js_bitmap_set_font_outline(int32_t id, int32_t v);
WRGSS_IMPORT void     js_bitmap_set_font_color(int32_t id, int32_t r, int32_t g, int32_t b, int32_t a);
WRGSS_IMPORT void     js_bitmap_set_font_out_color(int32_t id, int32_t r, int32_t g, int32_t b, int32_t a);

/* ---------- Sprite ---------- */
WRGSS_IMPORT int32_t  js_sprite_create(int32_t viewport_id);
WRGSS_IMPORT void     js_sprite_dispose(int32_t id);
WRGSS_IMPORT void     js_sprite_update(int32_t id);
WRGSS_IMPORT void     js_sprite_flash(int32_t id, int32_t r, int32_t g, int32_t b, int32_t a, int32_t dur);
WRGSS_IMPORT void     js_sprite_set_bitmap(int32_t id, int32_t bitmap_id);
WRGSS_IMPORT void     js_sprite_set_src_rect(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h);
WRGSS_IMPORT void     js_sprite_set_visible(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_x(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_y(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_z(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_ox(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_oy(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_zoom_x(int32_t id, double v);
WRGSS_IMPORT void     js_sprite_set_zoom_y(int32_t id, double v);
WRGSS_IMPORT void     js_sprite_set_angle(int32_t id, double v);
WRGSS_IMPORT void     js_sprite_set_mirror(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_opacity(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_blend_type(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_bush_depth(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_bush_opacity(int32_t id, int32_t v);
WRGSS_IMPORT void     js_sprite_set_color(int32_t id, int32_t r, int32_t g, int32_t b, int32_t a);
WRGSS_IMPORT void     js_sprite_set_tone(int32_t id, int32_t r, int32_t g, int32_t b, int32_t gray);
WRGSS_IMPORT int32_t  js_sprite_get_x(int32_t id);
WRGSS_IMPORT int32_t  js_sprite_get_y(int32_t id);
WRGSS_IMPORT int32_t  js_sprite_get_z(int32_t id);
WRGSS_IMPORT int32_t  js_sprite_width(int32_t id);
WRGSS_IMPORT int32_t  js_sprite_height(int32_t id);

/* ---------- Viewport ---------- */
WRGSS_IMPORT int32_t  js_viewport_create(int32_t x, int32_t y, int32_t w, int32_t h);
WRGSS_IMPORT void     js_viewport_dispose(int32_t id);
WRGSS_IMPORT void     js_viewport_update(int32_t id);
WRGSS_IMPORT void     js_viewport_flash(int32_t id, int32_t r, int32_t g, int32_t b, int32_t a, int32_t dur);
WRGSS_IMPORT void     js_viewport_set_rect(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h);
WRGSS_IMPORT void     js_viewport_set_visible(int32_t id, int32_t v);
WRGSS_IMPORT void     js_viewport_set_z(int32_t id, int32_t v);
WRGSS_IMPORT void     js_viewport_set_ox(int32_t id, int32_t v);
WRGSS_IMPORT void     js_viewport_set_oy(int32_t id, int32_t v);
WRGSS_IMPORT void     js_viewport_set_color(int32_t id, int32_t r, int32_t g, int32_t b, int32_t a);
WRGSS_IMPORT void     js_viewport_set_tone(int32_t id, int32_t r, int32_t g, int32_t b, int32_t gray);

/* ---------- Window ---------- */
WRGSS_IMPORT int32_t  js_window_create(int32_t x, int32_t y, int32_t w, int32_t h);
WRGSS_IMPORT void     js_window_dispose(int32_t id);
WRGSS_IMPORT void     js_window_update(int32_t id);
WRGSS_IMPORT void     js_window_move(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h);
WRGSS_IMPORT int32_t  js_window_open(int32_t id);
WRGSS_IMPORT int32_t  js_window_close(int32_t id);
WRGSS_IMPORT void     js_window_do_open(int32_t id);
WRGSS_IMPORT void     js_window_do_close(int32_t id);
WRGSS_IMPORT void     js_window_set_windowskin(int32_t id, int32_t bmp_id);
WRGSS_IMPORT void     js_window_set_contents(int32_t id, int32_t bmp_id);
WRGSS_IMPORT void     js_window_set_cursor_rect(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h);
WRGSS_IMPORT void     js_window_set_active(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_visible(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_arrows_visible(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_pause(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_x(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_y(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_width(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_height(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_z(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_ox(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_oy(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_padding(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_padding_bottom(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_opacity(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_back_opacity(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_contents_opacity(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_openness(int32_t id, int32_t v);
WRGSS_IMPORT void     js_window_set_tone(int32_t id, int32_t r, int32_t g, int32_t b, int32_t gray);
WRGSS_IMPORT int32_t  js_window_get_x(int32_t id);
WRGSS_IMPORT int32_t  js_window_get_y(int32_t id);
WRGSS_IMPORT int32_t  js_window_get_width(int32_t id);
WRGSS_IMPORT int32_t  js_window_get_height(int32_t id);
WRGSS_IMPORT int32_t  js_window_get_openness(int32_t id);

/* ---------- Plane ---------- */
WRGSS_IMPORT int32_t  js_plane_create(int32_t viewport_id);
WRGSS_IMPORT void     js_plane_dispose(int32_t id);
WRGSS_IMPORT void     js_plane_set_bitmap(int32_t id, int32_t bitmap_id);
WRGSS_IMPORT void     js_plane_set_ox(int32_t id, int32_t v);
WRGSS_IMPORT void     js_plane_set_oy(int32_t id, int32_t v);
WRGSS_IMPORT void     js_plane_set_z(int32_t id, int32_t v);
WRGSS_IMPORT void     js_plane_update(int32_t id);

/* ---------- Tilemap ---------- */
WRGSS_IMPORT int32_t  js_tilemap_create(int32_t viewport_id);
WRGSS_IMPORT void     js_tilemap_dispose(int32_t id);
WRGSS_IMPORT void     js_tilemap_set_map_data(int32_t id, int32_t table_id);
WRGSS_IMPORT void     js_tilemap_set_bitmap(int32_t id, int32_t index, int32_t bitmap_id);
WRGSS_IMPORT void     js_tilemap_set_flags(int32_t id, int32_t table_id);
WRGSS_IMPORT void     js_tilemap_set_flash_data(int32_t id, int32_t table_id);
WRGSS_IMPORT void     js_tilemap_set_visible(int32_t id, int32_t v);
WRGSS_IMPORT void     js_tilemap_set_ox(int32_t id, int32_t v);
WRGSS_IMPORT void     js_tilemap_set_oy(int32_t id, int32_t v);
WRGSS_IMPORT void     js_tilemap_update(int32_t id);

/* ---------- Table ---------- */
WRGSS_IMPORT int32_t  js_table_create(int32_t x, int32_t y, int32_t z);
WRGSS_IMPORT void     js_table_dispose(int32_t id);
WRGSS_IMPORT void     js_table_resize(int32_t id, int32_t x, int32_t y, int32_t z);
WRGSS_IMPORT int32_t  js_table_get(int32_t id, int32_t x, int32_t y, int32_t z);
WRGSS_IMPORT void     js_table_set(int32_t id, int32_t x, int32_t y, int32_t z, int32_t val);
WRGSS_IMPORT int32_t  js_table_xsize(int32_t id);
WRGSS_IMPORT int32_t  js_table_ysize(int32_t id);
WRGSS_IMPORT int32_t  js_table_zsize(int32_t id);

/* ---------- File / Dir ---------- */
WRGSS_IMPORT int32_t  js_file_exists(const char *path);
/* out_ptr/out_len receive host-allocated pointer/len. Call js_file_free(ptr). */
WRGSS_IMPORT int32_t  js_file_read(const char *path, int32_t *out_ptr, int32_t *out_len);
WRGSS_IMPORT void     js_file_free(int32_t ptr);
WRGSS_IMPORT int32_t  js_file_write(const char *path, const uint8_t *data, int32_t len);
WRGSS_IMPORT int32_t  js_file_delete(const char *path);
WRGSS_IMPORT int32_t  js_file_mtime(const char *path);
/* Returns i32 pointer to a \n-joined UTF-8 string (NUL-terminated) or 0. */
WRGSS_IMPORT int32_t  js_dir_glob(const char *pattern);

/* ---------- Regexp ---------- */
WRGSS_IMPORT int32_t  js_regexp_create(const char *pattern, int32_t flags);
WRGSS_IMPORT void     js_regexp_dispose(int32_t id);
WRGSS_IMPORT int32_t  js_regexp_exec(int32_t id, const char *str);
WRGSS_IMPORT int32_t  js_regexp_match_start(void);
WRGSS_IMPORT int32_t  js_regexp_match_end(void);
WRGSS_IMPORT int32_t  js_regexp_capture_count(void);
WRGSS_IMPORT int32_t  js_regexp_capture_start(int32_t id, int32_t idx);
WRGSS_IMPORT int32_t  js_regexp_capture_end(int32_t id, int32_t idx);
WRGSS_IMPORT void     js_regexp_set_last_match(void);

/* ---------- System ---------- */
WRGSS_IMPORT void     js_msgbox(const char *msg);
WRGSS_IMPORT void     js_rgss_stop(void);
WRGSS_IMPORT double   js_get_time_ms(void);
WRGSS_IMPORT double   js_time_at(double sec);

#ifdef __cplusplus
}
#endif

#endif /* WEBRGSS_IMPORTS_H */
