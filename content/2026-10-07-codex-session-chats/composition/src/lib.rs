use fframes::{
    AudioMap, AudioTimestamp::Second, AudioTrack, Color, Duration, FFramesContext, Frame, Scene,
    Scenes, Svgr, Transform, Video, include_media_dir,
};
use tardy_reel_library::{Format, Plan, Project, Theme, select};

include_media_dir!(pub struct TardySessionReelMedia, "media");
pub const WIDTH: usize = 1080;
pub const HEIGHT: usize = 1920;
const DURATIONS: [f32; 5] = [5., 7., 8., 6., 7.];
const NAMES: [&str; 5] = ["Hook", "Identity", "Control", "Evidence", "Rollout"];

pub struct TardySessionReelVideo<'a> {
    pub media: &'a TardySessionReelMedia,
    pub plan: Plan,
    shots: [Shot; 5],
}
impl std::fmt::Debug for TardySessionReelVideo<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionChats")
            .field("plan", &self.plan)
            .finish()
    }
}
impl<'a> TardySessionReelVideo<'a> {
    pub fn new(media: &'a TardySessionReelMedia, _title: &str) -> Self {
        let project: Project =
            serde_json::from_str(include_str!("../library.json")).expect("checked project library");
        let plan = select(&project, Some(Format::Walkthrough), 42, &[]).expect("checked selection");
        let shots = std::array::from_fn(|kind| Shot {
            kind,
            theme: plan.variant.theme.clone(),
            entrance: plan.variant.entrance_ms as f32 / 1000.,
        });
        Self { media, plan, shots }
    }
}
#[derive(Debug)]
struct Shot {
    kind: usize,
    theme: Theme,
    entrance: f32,
}
fn line<'a>(text: &'a str, x: usize, y: usize, size: usize, color: &'a str) -> Svgr<'a> {
    fframes::svgr!(<text x={x} y={y} font-size={size} fill={color}>{text}</text>)
}
impl Scene for Shot {
    fn name(&self) -> &'static str {
        NAMES[self.kind]
    }
    fn duration(&self) -> Duration<'_> {
        Duration::Seconds(DURATIONS[self.kind])
    }
    fn render_frame<'a>(&'a self, frame: Frame, _ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
        let white = self.theme.foreground.as_str();
        let yellow = self.theme.accent.as_str();
        let t = (frame.seconds() / self.entrance).clamp(0., 1.);
        let eased = 1. - (1. - t).powi(3);
        let panel = match self.kind {
            0 => fframes::svgr!(<g>
                <rect x="110" y="805" width="860" height="395" rx="24" fill="#17171D" stroke="#373740" />
                <rect x="145" y="840" width="790" height="62" rx="10" fill="#24242D" />
                {line("CODEX SESSION",170,883,34,"#A8A8B4")}
                {line("Existing work",160,985,65,white)}
                {line("One persistent Tardy identity.",160,1065,43,yellow)}
                {line("No new agent for every tab.",160,1135,40,"#A8A8B4")}
            </g>),
            1 => {
                let cards: Vec<_> = ["Build session", "Docs session", "Research session"].iter().enumerate().map(|(i,label)| {
                    let y = 810 + i * 146;
                    let accent = if i == 0 { yellow } else { "#373740" };
                    fframes::svgr!(<g>
                        <rect x="110" y={y} width="860" height="120" rx="16" fill="#17171D" stroke={accent} stroke-width="2" />
                        <circle cx="166" cy={y+60} r="12" fill={accent} />
                        {line(label,205,y+76,48,white)}
                        {line("CHAT",790,y+73,30,yellow)}
                    </g>)
                }).collect();
                fframes::svgr!(<g>{cards}{line("Same @codex_avery. Separate context.",110,1340,40,"#A8A8B4")}</g>)
            }
            2 => fframes::svgr!(<g>
                {line("EXAMPLE FOLLOW-UP",110,785,32,"#A8A8B4")}
                <rect x="230" y="840" width="740" height="122" rx="24" fill={yellow} />
                {line("Continue the work.",270,919,53,"#0A0A0D")}
                <rect x="110" y="1012" width="810" height="170" rx="24" fill="#17171D" stroke="#373740" />
                {line("Original session.",150,1084,51,white)}
                {line("Same project + permissions.",150,1141,39,"#A8A8B4")}
                {line("Send / Steer / Stop",110,1320,55,yellow)}
            </g>),
            3 => {
                let rows: Vec<_> = [("25","Host tests"),("10","PG17 tests"),("1","OpenAPI test")].iter().enumerate().map(|(i,(count,label))| {
                    let y = 820 + i*152;
                    fframes::svgr!(<g>{line(count,110,y+65,88,yellow)}{line(label,300,y+55,49,white)}<path d={format!("M 110 {} H 960", y+102)} stroke="#373740" stroke-width="2" /></g>)
                }).collect();
                fframes::svgr!(<g>{rows}{line("Focused checks. Local development cut.",110,1340,36,"#A8A8B4")}</g>)
            }
            _ => fframes::svgr!(<g>
                <rect x="110" y="810" width="860" height="390" rx="24" fill="#17171D" stroke="#373740" />
                {line("Owner-only session chats",150,899,49,white)}
                {line("Native approvals stay native",150,983,44,"#A8A8B4")}
                {line("Not activated in the live app yet",150,1083,38,yellow)}
                {line("Don't be tardy.",110,1335,67,white)}
            </g>),
        };
        let headers = [
            ["Your Codex.", "Your chats."],
            ["One identity.", "Many sessions."],
            ["Control the", "original session."],
            ["36 checks.", "One new loop."],
            ["Built. Verified.", "Rollout next."],
        ];
        fframes::svgr!(<g font-family="DM Sans" font-weight="500">
            {line("tardy",110,292,66,white)}<circle cx="276" cy="278" r="10" fill="#FF334B" />
            {line("NEXT AGENT HOST",110,393,34,yellow)}
            {line(headers[self.kind][0],110,540,96,white)}
            {line(headers[self.kind][1],110,663,96,white)}
            <g transform={Transform::translate(0., (1.-eased)*35.)} opacity={eased}>{panel}</g>
            {line("ILLUSTRATIVE FLOW / OCT 7, 2026",110,1470,30,"#A8A8B4")}
        </g>)
    }
}
impl Video for TardySessionReelVideo<'_> {
    const FPS: usize = 30;
    const WIDTH: usize = WIDTH;
    const HEIGHT: usize = HEIGHT;
    const BACKGROUND_COLOR: Color = Color::BLACK;
    fn duration(&self) -> Duration<'_> {
        Duration::Auto
    }
    fn define_scenes(&self) -> Scenes<'_> {
        Scenes::from(
            self.shots
                .iter()
                .map(|s| s as &dyn Scene)
                .collect::<Vec<_>>(),
        )
    }
    fn audio(&self) -> AudioMap<'_> {
        AudioMap::from([AudioTrack::new("work-bed.wav", Second(0.)..Second(33.))
            .fade_in(0.4)
            .fade_out(1.5)])
    }
    fn render_frame<'a>(&'a self, frame: Frame, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
        let progress = (frame.global_index as f32 / (33. * 30.)).clamp(0., 1.);
        fframes::svgr!(<svg xmlns="http://www.w3.org/2000/svg" width={WIDTH} height={HEIGHT}>
            <rect width={WIDTH} height={HEIGHT} fill={self.plan.variant.theme.background.as_str()} />
            {ctx.render_scenes(&frame)}
            <rect x="110" y="1510" width="860" height="4" fill="#26262F" />
            <rect x="110" y="1510" width={(860.*progress).max(0.5)} height="4" fill={self.plan.variant.theme.accent.as_str()} />
        </svg>)
    }
}
