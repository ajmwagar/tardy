use uuid::Uuid;

pub fn public_path(id: Uuid) -> String {
    format!("/t/{id}")
}

pub fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Render user-authored URLs without accepting HTML or executable URL schemes.
pub fn caption_html(caption: &str) -> String {
    let mut output = String::new();
    let mut rest = caption;
    while let Some(start) = rest
        .find("https://")
        .into_iter()
        .chain(rest.find("http://"))
        .min()
    {
        output.push_str(&escape(&rest[..start]));
        rest = &rest[start..];
        let end = rest
            .find(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\''))
            .unwrap_or(rest.len());
        let candidate = &rest[..end];
        let link = candidate.trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']']);
        let valid = url::Url::parse(link).is_ok_and(|url| {
            url.host_str().is_some() && url.username().is_empty() && url.password().is_none()
        });
        if valid {
            let safe = escape(link);
            output.push_str(&format!("<a href=\"{safe}\" rel=\"ugc\">{safe}</a>"));
            output.push_str(&escape(&candidate[link.len()..]));
        } else {
            output.push_str(&escape(candidate));
        }
        rest = &rest[end..];
    }
    output.push_str(&escape(rest));
    output
}

pub fn public_page(id: Uuid, caption: &str, author: &str, has_poster: bool) -> String {
    let canonical = format!("https://api.tardy.news{}", public_path(id));
    let viewer = format!("https://tardy.news/viewer.html?id={id}");
    let image = if has_poster {
        format!("{canonical}/poster")
    } else {
        "https://tardy.news/brands/tardy.png".into()
    };
    let hook: String = caption
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("A Tardy worth sharing")
        .chars()
        .take(120)
        .collect();
    let title = escape(&format!("{hook} · @{author} on Tardy"));
    let description = escape(&caption.chars().take(300).collect::<String>());
    let caption = caption_html(caption);
    let author = escape(author);
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<meta name="description" content="{description}"><link rel="canonical" href="{canonical}"><link rel="icon" href="https://tardy.news/brand/tardy-alarm-v1.svg?v=1">
<meta property="og:type" content="article"><meta property="og:site_name" content="Tardy"><meta property="og:url" content="{canonical}"><meta property="og:title" content="{title}"><meta property="og:description" content="{description}"><meta property="og:image" content="{image}"><meta property="og:image:alt" content="{title}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{title}"><meta name="twitter:description" content="{description}"><meta name="twitter:image" content="{image}"><link rel="stylesheet" href="https://tardy.news/viewer.css"></head>
<body><header><a class="brand" href="https://tardy.news/">TARDY</a><a href="https://tardy.news/ios.html">Get Tardy</a></header><main><section><a href="{viewer}"><img src="{image}" alt="{title}" style="max-width:100%;max-height:75vh"></a></section><article><small>SHARED BY @{author}</small><h1>{title}</h1><p style="white-space:pre-wrap">{caption}</p><nav><a class="button" href="{viewer}">Watch / open this Tardy</a></nav></article></main></body></html>"#
    )
}

pub fn unavailable_page() -> &'static str {
    "<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"><title>Tardy · Post unavailable</title></head><body><p>This Tardy is private, removed, or unavailable.</p><a href=\"https://tardy.news/\">Open Tardy</a></body></html>"
}
