//! Shared narrative concepts, project-owned presentation, deterministic selection.
//! No rendering, credentials, facts generation or publishing in this boundary.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Format {
    Milestone,
    Pipeline,
    Walkthrough,
}

impl Format {
    pub const ALL: [Self; 3] = [Self::Milestone, Self::Pipeline, Self::Walkthrough];
    pub fn concept(self) -> &'static str {
        match self {
            Self::Milestone => "Hook → change → evidence → boundary",
            Self::Pipeline => "Problem → ordered stages → evidence → boundary",
            Self::Walkthrough => "Goal → numbered steps → evidence → boundary",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Theme {
    pub background: String,
    pub foreground: String,
    pub accent: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Variant {
    pub id: String,
    pub format: Format,
    pub theme: Theme,
    /// Bounded entrance time; never randomize facts or scene ordering.
    pub entrance_ms: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub id: String,
    pub revision: u32,
    pub variants: Vec<Variant>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub schema_version: u32,
    pub project: String,
    pub project_revision: u32,
    pub seed: u64,
    /// Full selected presentation is frozen, not just a pointer to mutable config.
    pub variant: Variant,
}

fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

pub fn validate(project: &Project) -> Result<(), String> {
    if !identifier(&project.id)
        || project.revision == 0
        || project.variants.is_empty()
        || project.variants.len() > 64
    {
        return Err("invalid project identity, revision or variant count".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for v in &project.variants {
        if !identifier(&v.id) || !ids.insert(&v.id) || !(300..=600).contains(&v.entrance_ms) {
            return Err("invalid/duplicate variant identity or entrance timing".into());
        }
        if ![&v.theme.background, &v.theme.foreground, &v.theme.accent]
            .into_iter()
            .all(|s| color(s))
        {
            return Err("theme colors must be #RRGGBB".into());
        }
        let luminance = |s: &str| {
            let channel = |offset| {
                let c = u8::from_str_radix(&s[offset..offset + 2], 16).unwrap() as f64 / 255.;
                if c <= 0.04045 {
                    c / 12.92
                } else {
                    ((c + 0.055) / 1.055).powf(2.4)
                }
            };
            0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
        };
        let bg = luminance(&v.theme.background);
        for text in [&v.theme.foreground, &v.theme.accent] {
            let fg = luminance(text);
            if (fg.max(bg) + 0.05) / (fg.min(bg) + 0.05) < 4.5 {
                return Err("insufficient theme contrast".into());
            }
        }
    }
    Ok(())
}

/// Stable FNV-1a score (not cryptography), independent of Rust's randomized hashers.
fn score(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    })
}

pub fn select(
    project: &Project,
    format: Option<Format>,
    seed: u64,
    history: &[Plan],
) -> Result<Plan, String> {
    validate(project)?;
    let recent: Vec<_> = history
        .iter()
        .rev()
        .filter(|p| p.project == project.id)
        .take(6)
        .collect();
    let candidates: Vec<_> = project
        .variants
        .iter()
        .filter(|v| format.is_none_or(|f| f == v.format))
        .collect();
    if candidates.is_empty() {
        return Err("project has no variant compatible with requested format".into());
    }
    let last = recent.first();
    let chosen = candidates
        .iter()
        .min_by_key(|v| {
            let immediate = last.is_some_and(|p| p.variant.id == v.id);
            let uses = recent.iter().filter(|p| p.variant.id == v.id).count();
            let format_uses = recent
                .iter()
                .filter(|p| p.variant.format == v.format)
                .count();
            let key = format!("{}:{}:{}:{}", project.id, project.revision, seed, v.id);
            (immediate, uses, format_uses, score(key.as_bytes()), &v.id)
        })
        .unwrap();
    Ok(Plan {
        schema_version: 1,
        project: project.id.clone(),
        project_revision: project.revision,
        seed,
        variant: (*chosen).clone(),
    })
}

pub fn record(history: &mut Vec<Plan>, plan: Plan) -> Result<(), String> {
    if plan.schema_version != 1 {
        return Err("unsupported plan version".into());
    }
    validate(&Project {
        id: plan.project.clone(),
        revision: plan.project_revision,
        variants: vec![plan.variant.clone()],
    })?;
    if !history.contains(&plan) {
        history.push(plan);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project() -> Project {
        Project {
            id: "umie".into(),
            revision: 1,
            variants: Format::ALL
                .into_iter()
                .enumerate()
                .map(|(i, format)| Variant {
                    id: format!("v{i}"),
                    format,
                    theme: Theme {
                        background: "#0A0A0D".into(),
                        foreground: "#FFFFFF".into(),
                        accent: "#FFC21A".into(),
                    },
                    entrance_ms: 400,
                })
                .collect(),
        }
    }
    #[test]
    fn repeatable_and_order_independent() {
        let mut p = project();
        let a = select(&p, None, 42, &[]).unwrap();
        p.variants.reverse();
        assert_eq!(a, select(&p, None, 42, &[]).unwrap());
        assert_eq!(
            a,
            serde_json::from_str::<Plan>(&serde_json::to_string(&a).unwrap()).unwrap()
        );
    }
    #[test]
    fn history_is_project_scoped_and_avoids_last() {
        let p = project();
        let a = select(&p, None, 42, &[]).unwrap();
        let b = select(&p, None, 42, &[a.clone()]).unwrap();
        assert_ne!(a.variant.id, b.variant.id);
        let mut foreign = a.clone();
        foreign.project = "other".into();
        assert_eq!(a, select(&p, None, 42, &[foreign]).unwrap());
    }
    #[test]
    fn cycle_and_idempotent_record() {
        let p = project();
        let mut h = vec![];
        for _ in 0..9 {
            let a = select(&p, None, 7, &h).unwrap();
            record(&mut h, a.clone()).unwrap();
            let n = h.len();
            record(&mut h, a).unwrap();
            assert_eq!(n, h.len());
        }
        assert!(h.windows(2).all(|w| w[0].variant.id != w[1].variant.id));
    }
    #[test]
    fn explicit_format_and_failures() {
        let mut p = project();
        assert_eq!(
            select(&p, Some(Format::Pipeline), 0, &[])
                .unwrap()
                .variant
                .format,
            Format::Pipeline
        );
        p.variants.retain(|v| v.format != Format::Pipeline);
        assert!(select(&p, Some(Format::Pipeline), 0, &[]).is_err());
        p.variants[0].theme.accent = "#111111".into();
        assert!(validate(&p).is_err());
        p.variants[0].theme.accent = "not a color".into();
        assert!(validate(&p).is_err());
    }
}
