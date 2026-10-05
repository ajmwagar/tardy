use fframes::{
    AudioMap, AudioTimestamp::Second, AudioTrack, Color, Duration, FFramesContext, Frame, Svgr,
    Transform, Video, include_media_dir,
};

include_media_dir!(pub struct TardyWorkReelsMedia, "media");
pub const WIDTH: usize = 1080;
pub const HEIGHT: usize = 1920;
const FONT: &str = "DM Sans";
use tardy_reel_library::{Format, Plan};

pub struct TardyWorkReelsVideo<'a> {
    plan: Option<Plan>,
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
    pub fn with_plan(mut self, plan: Plan) -> Result<Self, String> {
        if plan.project != self.topic.to_ascii_lowercase() {
            return Err("plan belongs to another project".into());
        }
        tardy_reel_library::record(&mut vec![], plan.clone())?;
        self.plan = Some(plan);
        Ok(self)
    }
    pub fn new(media: &'a TardyWorkReelsMedia, topic: &str) -> Self {
        match topic {
            "umie" => Self {
                plan: None,
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
                plan: None,
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
                plan: None,
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
                plan: None,
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
                plan: None,
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
        let entrance = self
            .plan
            .as_ref()
            .map_or(0.5, |p| p.variant.entrance_ms as f32 / 1000.);
        let progress = (local / entrance).clamp(0., 1.);
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
        let accent = self
            .plan
            .as_ref()
            .map_or("#FFC21A", |p| p.variant.theme.accent.as_str());
        let foreground = self
            .plan
            .as_ref()
            .map_or("#FFFFFF", |p| p.variant.theme.foreground.as_str());
        let background = self
            .plan
            .as_ref()
            .map_or("#0A0A0D", |p| p.variant.theme.background.as_str());
        let panel = if self.plan.is_some() {
            background
        } else {
            "#18181F"
        };
        let muted = if self.plan.is_some() {
            foreground
        } else {
            "#9A9AA5"
        };
        let format = self
            .plan
            .as_ref()
            .map_or(Format::Milestone, |p| p.variant.format);
        let content: Vec<Svgr> = if scene == 1 && format == Format::Pipeline {
            self.steps.iter().enumerate().map(|(i,line)| {
                let y=890+i*168;
                let opacity=((local-0.4-i as f32*0.15)/0.4).clamp(0.,1.);
                fframes::svgr!(<g opacity={opacity}>
                    <rect x="94" y={y-56} width="10" height="104" fill={accent} />
                    <text x="138" y={y} font-family={FONT} font-size="44" font-weight="500" fill={foreground}>{*line}</text>
                    {if i<2 { fframes::svgr!(<path d={format!("M 138 {} v 24 m -7 -7 l 7 7 l 7 -7", y+24)} stroke={accent} stroke-width="3" fill="none" />) } else { fframes::svgr!(<text x="138" y={y+58} font-family={FONT} font-size="30" font-weight="500" fill={accent}>"OUTPUT / BOUNDARY"</text>) }}
                </g>)
            }).collect()
        } else if scene == 1 && format == Format::Walkthrough {
            self.steps.iter().enumerate().map(|(i,line)| {
                let y=930+i*156;
                let opacity=((local-0.4-i as f32*0.12)/0.4).clamp(0.,1.);
                fframes::svgr!(<g opacity={opacity}>
                    <circle cx="130" cy={y-16} r="36" fill={accent} />
                    <text x="130" y={y-3} text-anchor="middle" font-family={FONT} font-size="38" font-weight="500" fill={background}>{(i+1).to_string()}</text>
                    <text x="188" y={y} font-family={FONT} font-size="42" font-weight="500" fill={foreground}>{*line}</text>
                    <rect x="188" y={y+40} width="790" height="2" fill={accent} />
                </g>)
            }).collect()
        } else if scene == 1 {
            self.steps.iter().enumerate().map(|(i, line)| {
                let y = 940 + i * 152;
                let delay = (local - 0.6 - i as f32 * 0.2).clamp(0., 0.4) / 0.4;
                fframes::svgr!(<g opacity={delay}>
                    <rect x="94" y={y - 66} width="892" height="116" rx="18" fill={panel} stroke={if self.plan.is_some() { accent } else { "none" }} stroke-width="2" />
                    <text x="124" y={y} font-family={FONT} font-size="48" font-weight="500" fill={foreground}>{*line}</text>
                </g>)
            }).collect()
        } else if scene == 2 {
            vec![fframes::svgr!(<g>
                <rect x="94" y="850" width="892" height="414" rx="20" fill={panel} stroke={if self.plan.is_some() { accent } else { "none" }} stroke-width="2" />
                {self.evidence.iter().enumerate().map(|(i, line)| fframes::svgr!(<text x="128" y={980 + i * 112} font-family={FONT} font-size="38" font-weight="500" fill={foreground}>{*line}</text>)).collect::<Vec<_>>()}
            </g>)]
        } else {
            vec![]
        };
        fframes::svgr!(
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width={WIDTH} height={HEIGHT}>
                <rect width="1080" height="1920" fill={background} />
                <rect x="94" y="260" width="68" height="8" rx="4" fill={accent} />
                <text x="184" y="283" font-family={FONT} font-size="34" font-weight="500" fill={accent}>"FPL / WORK NOTES"</text>
                <text x="94" y="430" font-family={FONT} font-size="42" font-weight="500" fill={muted}>{self.topic}</text>
                <g transform={Transform::translate(0, rise)}>
                    <text x="94" y="620" font-family={FONT} font-size="84" font-weight="500" fill={foreground}>{title[0]}</text>
                    <text x="94" y="734" font-family={FONT} font-size="68" font-weight="500" fill={accent}>{title[1]}</text>
                </g>
                {content}
                <text x="94" y="1380" font-family={FONT} font-size="32" font-weight="500" fill={muted}>{self.limitation}</text>
                <rect x="94" y="1450" width={(time / 20. * 892.).max(0.5)} height="5" rx="2" fill={accent} />
                <text x="94" y={if self.plan.is_some() {1488} else {1510}} font-family={FONT} font-size="32" font-weight="500" fill={foreground}>"DON'T BE TARDY."</text>
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
