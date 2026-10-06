use std::{fs, process::Command};

#[test]
fn records_atomically_and_deduplicates_retries() {
    let directory = std::env::temp_dir().join(format!(
        "tardy-reel-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&directory).unwrap();
    let history = directory.join("history.json");
    let plan = directory.join("plan.json");
    fs::write(&history, "[]").unwrap();
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../content/reel-library/projects/umie.json");
    let output = Command::new(env!("CARGO_BIN_EXE_tardy-reel-library"))
        .args([
            "plan",
            project.to_str().unwrap(),
            "pipeline",
            "42",
            history.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    fs::write(&plan, &output.stdout).unwrap();
    let record = || {
        Command::new(env!("CARGO_BIN_EXE_tardy-reel-library"))
            .args(["record", plan.to_str().unwrap(), history.to_str().unwrap()])
            .output()
            .unwrap()
    };
    assert!(record().status.success());
    assert!(record().status.success());
    let records: Vec<tardy_reel_library::Plan> =
        serde_json::from_slice(&fs::read(&history).unwrap()).unwrap();
    assert_eq!(records.len(), 1);
    fs::write(history.with_extension("lock"), "").unwrap();
    assert!(!record().status.success());
    assert_eq!(
        serde_json::from_slice::<Vec<tardy_reel_library::Plan>>(&fs::read(&history).unwrap())
            .unwrap()
            .len(),
        1
    );
    fs::remove_dir_all(directory).unwrap();
}
