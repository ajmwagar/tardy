from manim import *


class GradientDescentScene(Scene):
    def construct(self):
        self.camera.background_color = "#090909"
        yellow = "#FFD400"
        title = Text("GRADIENT DESCENT", weight=BOLD, color=yellow).scale(0.52)
        title.to_edge(UP, buff=0.7)
        subtitle = Text("Follow the slope downhill", color=WHITE).scale(0.34)
        subtitle.next_to(title, DOWN, buff=0.18)
        axes = Axes(
            x_range=[-3, 3, 1], y_range=[0, 5, 1], x_length=5.4, y_length=5.0,
            tips=False, axis_config={"color": "#555555", "stroke_width": 2},
        ).shift(DOWN * 0.45)
        curve = axes.plot(lambda x: 0.5 * x * x + 0.35, x_range=[-2.8, 2.8], color=yellow)
        dot = Dot(axes.c2p(2.6, 0.5 * 2.6 * 2.6 + 0.35), color=WHITE, radius=0.12)
        label = Text("start", color=WHITE).scale(0.3).next_to(dot, RIGHT)
        self.play(FadeIn(title), FadeIn(subtitle), Create(axes), Create(curve), run_time=1.2)
        self.play(FadeIn(dot), FadeIn(label), run_time=0.4)
        for x in [1.8, 1.1, 0.55, 0.2, 0.0]:
            point = axes.c2p(x, 0.5 * x * x + 0.35)
            self.play(dot.animate.move_to(point), label.animate.next_to(point, RIGHT), run_time=0.55)
        answer = Text("minimum", weight=BOLD, color=yellow).scale(0.42)
        answer.next_to(dot, DOWN, buff=0.28)
        self.play(Transform(label, answer), Flash(dot, color=yellow), run_time=0.7)
        self.wait(0.8)
