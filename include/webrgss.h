/*
 * webrgss.h — internal API used within the runtime (not exported to JS).
 */
#ifndef WEBRGSS_H
#define WEBRGSS_H

#include <mruby.h>
#include <mruby/data.h>
#include <mruby/value.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Get the shared mrb_state (NULL before wrgss_init). */
mrb_state *wrgss_mrb(void);

/* Shared MRB_TT_DATA descriptors. Each value-type class (Color/Tone/Rect)
 * and each JS-backed handle class (Bitmap/Sprite/Viewport/Window/Plane/
 * Tilemap) binds its allocator to one of these so `mrb_data_check_get_ptr`
 * can validate instance type. */
extern const struct mrb_data_type rgss_color_type;
extern const struct mrb_data_type rgss_tone_type;
extern const struct mrb_data_type rgss_rect_type;
extern const struct mrb_data_type rgss_bitmap_type;
extern const struct mrb_data_type rgss_sprite_type;
extern const struct mrb_data_type rgss_viewport_type;
extern const struct mrb_data_type rgss_window_type;
extern const struct mrb_data_type rgss_plane_type;
extern const struct mrb_data_type rgss_tilemap_type;

/* C-callable constructors that go through the Ruby-side `<Class>.new` so
 * that any user-defined subclass `initialize` is still dispatched. */
mrb_value rgss_color_new(mrb_state *mrb, double r, double g, double b, double a);
mrb_value rgss_tone_new(mrb_state *mrb, double r, double g, double b, double gr);
mrb_value rgss_rect_new(mrb_state *mrb, mrb_int x, mrb_int y, mrb_int w, mrb_int h);

/* Registration entry for every RGSS class/module. */
void wrgss_register_classes(mrb_state *mrb);

/* Per-module registrars (defined in individual rgss_*.c files). */
void wrgss_register_color(mrb_state *mrb);
void wrgss_register_tone(mrb_state *mrb);
void wrgss_register_rect(mrb_state *mrb);
void wrgss_register_table(mrb_state *mrb);
void wrgss_register_font(mrb_state *mrb);
void wrgss_register_graphics(mrb_state *mrb);
void wrgss_register_input(mrb_state *mrb);
void wrgss_register_audio(mrb_state *mrb);
void wrgss_register_bitmap(mrb_state *mrb);
void wrgss_register_sprite(mrb_state *mrb);
void wrgss_register_viewport(mrb_state *mrb);
void wrgss_register_window(mrb_state *mrb);
void wrgss_register_plane(mrb_state *mrb);
void wrgss_register_tilemap(mrb_state *mrb);
void wrgss_register_regexp(mrb_state *mrb);
void wrgss_register_data(mrb_state *mrb);

/* Native-id accessor helpers (stored as @__wrgss_id). */
int32_t wrgss_get_id(mrb_state *mrb, mrb_value self);
void    wrgss_set_id(mrb_state *mrb, mrb_value self, int32_t id);

/* Fetch an int argument with default. */
int32_t wrgss_optint(mrb_state *mrb, mrb_value v, int32_t def);

/* Convert a potentially numeric mrb_value to C integer. */
int32_t wrgss_to_int(mrb_state *mrb, mrb_value v);

/* Convert mrb_value to double, accepting Integer/Float. */
double wrgss_to_f(mrb_state *mrb, mrb_value v);

#ifdef __cplusplus
}
#endif

#endif /* WEBRGSS_H */
