use fframes::{
    AudioMap, AudioTimestamp::Second, AudioTrack, Color, Duration, FFramesContext, Frame, Svgr,
    Transform, Video, include_media_dir,
};

include_media_dir!(pub struct TardyWorkReelsMedia, "media");
pub const WIDTH: usize = 1080;
pub const HEIGHT: usize = 1920;
const FONT: &str = "DM Sans";

pub struct TardyWorkReelsVideo<'a> {
    pub media: &'a TardyWorkReelsMedia,
    topic: &'static str,
    hook: [&'static str; 2],
    reveal: [&'static str; 2],
    steps: [&'static str; 3],
    evidence: [&'static str; 3],
    limitation: &'static str,
}

impl std::fmt::Debug for TardyWorkReelsVideo<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkNotes")
            .field("topic", &self.topic)
            .finish()
    }
}

impl<'a> TardyWorkReelsVideo<'a> {
    pub fn new(media: &'a TardyWorkReelsMedia, topic: &str) -> Self {
        match topic {
            "umie" => Self {
                media,
                topic: "UMIE",
                hook: ["Your kernels.", "Mapped from source."],
                reveal: ["CUDA + Metal", "One inspectable map."],
                steps: [
                    "Read the source",
                    "Find kernel candidates",
                    "Keep evidence attached",
                ],
                evidence: [
                    "umie-bench / kernel_map.rs",
                    "CUDA + Metal candidate maps",
                    "commit 02ecc05",
                ],
                limitation: "Candidate map, not a speedup claim.",
            },
            "unibus" => Self {
                media,
                topic: "UNIBUS",
                hook: ["Printer status.", "No printer controls."],
                reveal: ["A narrow adapter.", "Not a remote control."],
                steps: [
                    "Pinned MQTT / TLS",
                    "Typed status snapshots",
                    "Stale means stale",
                ],
                evidence: [
                    "printer.status.v1",
                    "subscribe-only observer",
                    "commit 7f7cfd7",
                ],
                limitation: "Implemented; live enrollment is next.",
            },
            "mycelium" => Self {
                media,
                topic: "MYCELIUM",
                hook: ["Bad update?", "Keep the last good one."],
                reveal: ["Verify. Activate.", "Check. Recover."],
                steps: [
                    "Verify signed bytes",
                    "Check the owning process",
                    "Restore on failure",
                ],
                evidence: [
                    "mycelium software plan",
                    "mycelium software auto-run",
                    "fungOS / edge / README.md",
                ],
                limitation: "Experimental edge work, not a rollout.",
            },
            "isochrone" => Self {
                media,
                topic: "ISOCHRONE",
                hook: ["Wrong audio backend?", "Fail before silence."],
                reveal: ["Name the backend.", "Keep routing honest."],
                steps: [
                    "Separate devices from graphs",
                    "Select the native adapter",
                    "Reject unavailable adapters",
                ],
                evidence: [
                    "crates/isochrone/src/audio.rs",
                    "docs/unibus-audio-routing.md",
                    "commit ff43b3b",
                ],
                limitation: "Typed boundary; not every adapter exists.",
            },
            "holodeck" => Self {
                media,
                topic: "HOLODECK",
                hook: ["Your workspace.", "Floating beside you."],
                reveal: ["Canvas owns the UI.", "VR owns placement."],
                steps: [
                    "Capture the native workspace",
                    "Move and resize the window",
                    "Keep stale previews visible",
                ],
                evidence: [
                    "docs/canvas-window.md",
                    "app/applets/canvas.lua",
                    "commit 11b2f46",
                ],
                limitation: "View-only preview; not interactive streaming.",
            },
            _ => unreachable!("CLI restricts topic to known stories"),
        }
    }
}

impl Video for TardyWorkReelsVideo<'_> {
    const FPS: usize = 30;
    const WIDTH: usize = WIDTH;
    const HEIGHT: usize = HEIGHT;
    const BACKGROUND_COLOR: Color = Color::BLACK;
    fn duration(&self) -> Duration<'_> {
        Duration::Seconds(20.0)
    }
    fn audio(&self) -> AudioMap<'_> {
        AudioMap::from([AudioTrack::new("work-bed.wav", Second(0.)..Second(20.))])
    }
    fn render_frame<'a>(&'a self, frame: Frame, _ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
        let time = frame.seconds();
        let scene = (time / 5.).floor().min(3.) as usize;
        let local = time - scene as f32 * 5.;
        let progress = (local / 0.5).clamp(0., 1.);
        let rise = (1. - (1. - (1. - progress).powi(3))) * 44.;
        let title = if scene == 0 {
            self.hook
        } else if scene == 1 {
            self.reveal
        } else if scene == 2 {
            ["Here's the boundary.", "Not the hype."]
        } else {
            ["Real work.", "Worth keeping up with."]
        };
        let content: Vec<Svgr> = if scene == 1 {
            self.steps.iter().enumerate().map(|(i, line)| {
                let y = 940 + i * 152;
                let delay = (local - 0.6 - i as f32 * 0.2).clamp(0., 0.4) / 0.4;
                fframes::svgr!(<g opacity={delay}>
                    <rect x="94" y={y - 66} width="892" height="116" rx="18" fill="#18181F" />
                    <text x="124" y={y} font-family={FONT} font-size="48" font-weight="500" fill="#FFFFFF">{*line}</text>
                </g>)
            }).collect()
        } else if scene == 2 {
            vec![fframes::svgr!(<g>
                <rect x="94" y="850" width="892" height="414" rx="20" fill="#18181F" />
                {self.evidence.iter().enumerate().map(|(i, line)| fframes::svgr!(<text x="128" y={980 + i * 112} font-family={FONT} font-size="38" font-weight="500" fill="#FFFFFF">{*line}</text>)).collect::<Vec<_>>()}
            </g>)]
        } else {
            vec![]
        };
        fframes::svgr!(
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width={WIDTH} height={HEIGHT}>
                <rect width="1080" height="1920" fill="#0A0A0D" />
                <rect x="94" y="260" width="68" height="8" rx="4" fill="#FFC21A" />
                <text x="184" y="283" font-family={FONT} font-size="34" font-weight="500" fill="#FFC21A">"FPL / WORK NOTES"</text>
                <text x="94" y="430" font-family={FONT} font-size="42" font-weight="500" fill="#9A9AA5">{self.topic}</text>
                <g transform={Transform::translate(0, rise)}>
                    <text x="94" y="620" font-family={FONT} font-size="84" font-weight="500" fill="#FFFFFF">{title[0]}</text>
                    <text x="94" y="734" font-family={FONT} font-size="68" font-weight="500" fill="#FFC21A">{title[1]}</text>
                </g>
                {content}
                <text x="94" y="1380" font-family={FONT} font-size="32" font-weight="500" fill="#9A9AA5">{self.limitation}</text>
                <rect x="94" y="1450" width={(time / 20. * 892.).max(0.5)} height="5" rx="2" fill="#FFC21A" />
                <text x="94" y="1510" font-family={FONT} font-size="32" font-weight="500" fill="#FFFFFF">"DON'T BE TARDY."</text>
            </svg>
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn format_is_vertical() {
        assert_eq!((WIDTH, HEIGHT), (1080, 1920));
    }
}
