use std::{env, fs, io, path::PathBuf};

const CONFIGURATION: &str = r#"<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <!-- Keep the system and user font configuration. -->
  <include ignore_missing="no">/etc/fonts/fonts.conf</include>
  <selectfont>
    <rejectfont>
      <pattern>
        <patelt name="fontwrapper">
          <string>WOFF</string>
        </patelt>
      </pattern>
    </rejectfont>
  </selectfont>
</fontconfig>
"#;

/// Must run before Tauri/GTK starts any threads or creates a WebView.
pub fn configure() -> io::Result<()> {
    // Preserve an explicit launcher/user configuration as an opt-out.
    if env::var_os("FONTCONFIG_FILE").is_some_and(|value| !value.is_empty()) {
        return Ok(());
    }

    let config_home = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
                .map(|path| path.join(".config"))
        })
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "No Linux user configuration directory",
            )
        })?;

    // WebKit's sandbox exposes XDG_CONFIG_HOME/fontconfig. This subdirectory
    // is NOT conf.d, so other applications do not automatically load the rule.
    let directory = config_home.join("fontconfig").join("opentermx");
    let path = directory.join("fonts.conf");
    fs::create_dir_all(&directory)?;

    match fs::read(&path) {
        Ok(contents) if contents == CONFIGURATION.as_bytes() => {}
        Ok(_) => write_configuration(&directory, &path)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            write_configuration(&directory, &path)?;
        }
        Err(error) => return Err(error),
    }

    // Only this process and its children (including WebKitWebProcess) inherit
    // the setting. No font files, shared caches, or application databases change.
    // WebKitGTK/Skia loops forever on cached WOFF entries without FC_FAMILY:
    // https://bugs.webkit.org/show_bug.cgi?id=325185
    env::set_var("FONTCONFIG_FILE", &path);
    Ok(())
}

fn write_configuration(directory: &std::path::Path, path: &std::path::Path) -> io::Result<()> {
    // Publish a complete file even if multiple OpenTermX instances start.
    let temporary = directory.join(format!("fonts.conf.{}.tmp", std::process::id()));
    fs::write(&temporary, CONFIGURATION)?;
    fs::rename(temporary, path)
}
