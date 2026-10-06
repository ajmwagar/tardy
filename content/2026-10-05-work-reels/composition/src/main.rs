use fframes::cli::clap; // the derive below expands to `clap::...`
use fframes::{EncoderOptions, RenderOptions, StaticMediaProvider, cli};
use fframes_skia_renderer::{
    SkiaFFramesRenderer, SkiaPipelineConcurrencyPolicy, SkiaPipelineConfig, metal::SkiaMetalCtx,
};
use std::process::ExitCode;
use tardy_reel_library::{Format, Plan, Project, select};
use tardy_work_reels::{HEIGHT, TardyWorkReelsMedia, TardyWorkReelsVideo, WIDTH};

/// Flags of this video next to the standard ones of `fframes::cli` (render, frame, strip,
/// inspect, audio, ...). Run `cargo run --release -- --help`.
#[derive(Debug, clap::Args)]
struct VideoArgs {
    #[arg(long, default_value = "umie", global = true, value_parser = ["umie", "unibus", "mycelium", "isochrone", "holodeck", "library"])]
    title: String,
    #[arg(long, default_value = "auto", global = true, value_parser = ["auto", "legacy", "milestone", "pipeline", "walkthrough"])]
    format: String,
    #[arg(long, default_value_t = 0, global = true)]
    seed: u64,
    /// Project-local variant library; bundled library used when omitted.
    #[arg(long, global = true)]
    library: Option<std::path::PathBuf>,
    /// Read-only history. Recording happens explicitly after a successful delivery.
    #[arg(long, global = true)]
    history: Option<std::path::PathBuf>,
    /// Replay a frozen plan instead of selecting again.
    #[arg(long, global = true)]
    plan: Option<std::path::PathBuf>,
    /// Save selected plan with create-new semantics (never overwrite).
    #[arg(long, global = true)]
    write_plan: Option<std::path::PathBuf>,
}

fn selected_plan(args: &VideoArgs) -> Result<Option<Plan>, Box<dyn std::error::Error>> {
    if let Some(path) = &args.plan {
        if args.library.is_some()
            || args.history.is_some()
            || args.seed != 0
            || args.format != "auto"
        {
            return Err("--plan cannot be combined with selection flags".into());
        }
        return Ok(Some(serde_json::from_slice(&std::fs::read(path)?)?));
    }
    if args.format == "legacy" {
        return Ok(None);
    }
    let bundled = match args.title.as_str() {
        "umie" => include_str!("../../../reel-library/projects/umie.json"),
        "unibus" => include_str!("../../../reel-library/projects/unibus.json"),
        "mycelium" => include_str!("../../../reel-library/projects/mycelium.json"),
        "isochrone" => include_str!("../../../reel-library/projects/isochrone.json"),
        "holodeck" => include_str!("../../../reel-library/projects/holodeck.json"),
        _ => return Err("unknown project".into()),
    };
    let project: Project = if let Some(path) = &args.library {
        serde_json::from_slice(&std::fs::read(path)?)?
    } else {
        serde_json::from_str(bundled)?
    };
    if project.id != args.title {
        return Err("library belongs to another project".into());
    }
    let history: Vec<Plan> = if let Some(path) = &args.history {
        serde_json::from_slice(&std::fs::read(path)?)?
    } else {
        vec![]
    };
    let format = if args.format == "auto" {
        None
    } else {
        Some(serde_json::from_value::<Format>(
            args.format.clone().into(),
        )?)
    };
    Ok(Some(select(&project, format, args.seed, &history)?))
}

fn main() -> ExitCode {
    let args = cli::parse::<VideoArgs>();
    let media = TardyWorkReelsMedia::prepare().expect("media");
    let title = args.app.title.clone();
    let plan = match selected_plan(&args.app) {
        Ok(p) => p,
        Err(error) => {
            eprintln!("invalid reel plan: {error}");
            return ExitCode::FAILURE;
        }
    };
    let mut video = TardyWorkReelsVideo::new(&media, &title);
    if let Some(plan) = plan {
        video = match video.with_plan(plan.clone()) {
            Ok(v) => v,
            Err(error) => {
                eprintln!("invalid reel plan: {error}");
                return ExitCode::FAILURE;
            }
        };
        if let Some(path) = &args.app.write_plan {
            use std::io::Write;
            let result = (|| -> Result<(), Box<dyn std::error::Error>> {
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(path)?;
                file.write_all(&serde_json::to_vec_pretty(&plan)?)?;
                file.sync_all()?;
                Ok(())
            })();
            if let Err(error) = result {
                eprintln!("cannot save reel plan: {error}");
                return ExitCode::FAILURE;
            }
        }
    } else if args.app.write_plan.is_some() {
        eprintln!("legacy has no library plan to save");
        return ExitCode::FAILURE;
    }
    let gpu = SkiaMetalCtx::new(WIDTH, HEIGHT).expect("GPU context");

    cli::new(
        &video,
        RenderOptions {
            media: Some(&media),
            video_encoder_options: EncoderOptions {
                preferred_encoder: Some("libx264"),
                codec_params: Some(&[("crf", "20"), ("preset", "medium"), ("tune", "animation")]),
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .args(args)
    // Frame previews (frame, strip, onion, snapshot) render with the same Skia backend.
    .backend(
        SkiaFFramesRenderer::new_metal(
            &gpu,
            SkiaPipelineConfig {
                concurrency_policy: SkiaPipelineConcurrencyPolicy::MaxPerformance,
                ..Default::default()
            },
        )
        .expect("skia renderer"),
    )
    // `preview` opens the real-time GPU player.
    .preview(fframes_native_player::cli_preview)
    .run()
}
