//! Explicit plan/record tool. Previewing or rendering never records a use implicitly.
use std::{fs, path::Path};
use tardy_reel_library::{Format, Plan, Project, record, select};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("plan") if args.len() == 5 => {
            let project: Project = serde_json::from_slice(&fs::read(&args[1])?)?;
            let format = match args[2].as_str() { "auto" => None, value => Some(serde_json::from_value::<Format>(value.into())?) };
            let seed = args[3].parse()?;
            let history: Vec<Plan> = serde_json::from_slice(&fs::read(&args[4])?)?;
            println!("{}",serde_json::to_string_pretty(&select(&project,format,seed,&history)?)?);
        }
        Some("record") if args.len() == 3 => {
            let plan: Plan = serde_json::from_slice(&fs::read(&args[1])?)?;
            let path = Path::new(&args[2]);
            let lock = path.with_extension("lock");
            let _guard = fs::OpenOptions::new().write(true).create_new(true).open(&lock)?;
            let result = (|| -> Result<(), Box<dyn std::error::Error>> {
                let mut history: Vec<Plan> = serde_json::from_slice(&fs::read(path)?)?;
                record(&mut history,plan)?;
                let tmp=path.with_extension("pending");
                use std::io::Write;
                let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
                file.write_all(&serde_json::to_vec_pretty(&history)?)?; file.sync_all()?;
                fs::rename(&tmp,path)?;
                Ok(())
            })();
            fs::remove_file(lock)?;
            result?;
        }
        _ => return Err("usage: tardy-reel-library plan PROJECT.json auto|milestone|pipeline|walkthrough SEED HISTORY.json; or record PLAN.json HISTORY.json".into()),
    }
    Ok(())
}
