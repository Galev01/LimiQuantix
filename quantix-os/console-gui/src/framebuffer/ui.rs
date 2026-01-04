//! UI Rendering for Framebuffer Console
//!
//! Renders an ESXi-style console interface directly to the framebuffer using embedded-graphics.
//! Features:
//! - Header with branding and version
//! - Node status panel (hostname, IP, cluster status, uptime)
//! - Resource usage (CPU, memory, VMs)
//! - Function key menu
//! - Modal dialogs for confirmation/input

use embedded_graphics::{
    draw_target::DrawTarget,
    geometry::{Point, Size},
    mono_font::{ascii::*, MonoTextStyle},
    pixelcolor::Rgb888,
    prelude::*,
    primitives::{Line, PrimitiveStyle, Rectangle, RoundedRectangle},
    text::{Alignment, Text},
};

/// ESXi-inspired color palette
pub mod colors {
    use embedded_graphics::pixelcolor::Rgb888;

    pub const BG_DARK: Rgb888 = Rgb888::new(10, 15, 20);
    pub const BG_PANEL: Rgb888 = Rgb888::new(30, 40, 50);
    pub const BG_HEADER: Rgb888 = Rgb888::new(20, 30, 40);
    pub const BG_MENU: Rgb888 = Rgb888::new(40, 50, 60);
    pub const BG_DIALOG: Rgb888 = Rgb888::new(35, 45, 55);
    pub const BG_INPUT: Rgb888 = Rgb888::new(20, 25, 30);
    pub const ACCENT_CYAN: Rgb888 = Rgb888::new(0, 200, 255);
    pub const ACCENT_YELLOW: Rgb888 = Rgb888::new(255, 200, 0);
    pub const ACCENT_GREEN: Rgb888 = Rgb888::new(0, 200, 100);
    pub const ACCENT_RED: Rgb888 = Rgb888::new(255, 80, 80);
    pub const TEXT_PRIMARY: Rgb888 = Rgb888::new(230, 235, 240);
    pub const TEXT_MUTED: Rgb888 = Rgb888::new(100, 110, 120);
    pub const TEXT_BRIGHT: Rgb888 = Rgb888::new(255, 255, 255);
    pub const BORDER_LIGHT: Rgb888 = Rgb888::new(60, 70, 80);
    pub const PROGRESS_BG: Rgb888 = Rgb888::new(50, 55, 60);
    pub const PROGRESS_FILL: Rgb888 = Rgb888::new(0, 180, 230);
}

use colors::*;

/// System status data for rendering
#[derive(Debug, Clone, Default)]
pub struct SystemStatus {
    pub hostname: String,
    pub ip_address: String,
    pub cluster_status: String,
    pub uptime: String,
    pub version: String,
    pub cpu_percent: f32,
    pub memory_percent: f32,
    pub memory_used: String,
    pub memory_total: String,
    pub vm_count: i32,
    pub ssh_enabled: bool,
}

/// Menu item for the function key bar
#[derive(Debug, Clone)]
pub struct MenuItem {
    pub key: &'static str,
    pub label: &'static str,
}

/// Default menu items
pub const MENU_ITEMS: &[MenuItem] = &[
    MenuItem { key: "F2", label: "Network" },
    MenuItem { key: "F3", label: "SSH" },
    MenuItem { key: "F5", label: "Services" },
    MenuItem { key: "F7", label: "Diagnostics" },
    MenuItem { key: "F10", label: "Reboot" },
    MenuItem { key: "F12", label: "Shell" },
];

/// UI Renderer
pub struct UiRenderer {
    width: u32,
    height: u32,
    /// Padding from edges
    padding: u32,
    /// Line height for text
    line_height: u32,
}

impl UiRenderer {
    /// Create a new UI renderer for the given screen size
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            padding: 20,
            line_height: 24,
        }
    }

    /// Render the complete UI
    pub fn render<D>(&self, display: &mut D, status: &SystemStatus) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = Rgb888>,
    {
        // Clear background
        self.fill_background(display)?;

        // Render header
        self.render_header(display, &status.version)?;

        // Render status panel
        self.render_status_panel(display, status)?;

        // Render resource usage
        self.render_resources(display, status)?;

        // Render menu bar
        self.render_menu_bar(display)?;

        Ok(())
    }

    /// Fill the background
    fn fill_background<D>(&self, display: &mut D) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = Rgb888>,
    {
        Rectangle::new(Point::zero(), Size::new(self.width, self.height))
            .into_styled(PrimitiveStyle::with_fill(BG_DARK))
            .draw(display)
    }

    /// Render the header bar
    fn render_header<D>(&self, display: &mut D, version: &str) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = Rgb888>,
    {
        let header_height = 60;

        // Header background
        Rectangle::new(Point::zero(), Size::new(self.width, header_height))
            .into_styled(PrimitiveStyle::with_fill(BG_HEADER))
            .draw(display)?;

        // Bottom border
        Line::new(
            Point::new(0, header_height as i32 - 1),
            Point::new(self.width as i32, header_height as i32 - 1),
        )
        .into_styled(PrimitiveStyle::with_stroke(ACCENT_CYAN, 2))
        .draw(display)?;

        // Title
        let title_style = MonoTextStyle::new(&FONT_10X20, TEXT_BRIGHT);
        Text::with_alignment(
            "QUANTIX-OS",
            Point::new((self.width / 2) as i32, 30),
            title_style,
            Alignment::Center,
        )
        .draw(display)?;

        // Version (smaller, right-aligned)
        let version_style = MonoTextStyle::new(&FONT_6X13, TEXT_MUTED);
        let version_text = format!("v{}", version);
        Text::with_alignment(
            &version_text,
            Point::new((self.width / 2) as i32, 48),
            version_style,
            Alignment::Center,
        )
        .draw(display)?;

        Ok(())
    }

    /// Render the node status panel
    fn render_status_panel<D>(&self, display: &mut D, status: &SystemStatus) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = Rgb888>,
    {
        let panel_y = 80;
        let panel_height = 120;
        let panel_width = self.width - 2 * self.padding;

        // Panel background
        RoundedRectangle::with_equal_corners(
            Rectangle::new(
                Point::new(self.padding as i32, panel_y),
                Size::new(panel_width, panel_height),
            ),
            Size::new(8, 8),
        )
        .into_styled(PrimitiveStyle::with_fill(BG_PANEL))
        .draw(display)?;

        let text_style = MonoTextStyle::new(&FONT_9X18, TEXT_PRIMARY);
        let label_style = MonoTextStyle::new(&FONT_9X18, TEXT_MUTED);
        let value_style = MonoTextStyle::new(&FONT_9X18, ACCENT_CYAN);

        let col1_x = (self.padding + 20) as i32;
        let col2_x = (self.width / 2) as i32;
        let mut y = panel_y as i32 + 35;

        // Row 1: Node + Status
        Text::new("Node:", Point::new(col1_x, y), label_style).draw(display)?;
        Text::new(&status.hostname, Point::new(col1_x + 60, y), value_style).draw(display)?;

        Text::new("Status:", Point::new(col2_x, y), label_style).draw(display)?;
        let status_color = if status.cluster_status == "Standalone" {
            ACCENT_YELLOW
        } else {
            ACCENT_GREEN
        };
        let status_style = MonoTextStyle::new(&FONT_9X18, status_color);
        Text::new(&status.cluster_status, Point::new(col2_x + 80, y), status_style).draw(display)?;

        y += self.line_height as i32;

        // Row 2: IP + Uptime
        Text::new("IP:", Point::new(col1_x, y), label_style).draw(display)?;
        Text::new(&status.ip_address, Point::new(col1_x + 60, y), value_style).draw(display)?;

        Text::new("Uptime:", Point::new(col2_x, y), label_style).draw(display)?;
        Text::new(&status.uptime, Point::new(col2_x + 80, y), text_style).draw(display)?;

        y += self.line_height as i32;

        // Row 3: Management URL
        let url = format!("https://{}:8443", status.ip_address);
        Text::new("Mgmt URL:", Point::new(col1_x, y), label_style).draw(display)?;
        Text::new(&url, Point::new(col1_x + 100, y), value_style).draw(display)?;

        Ok(())
    }

    /// Render resource usage section
    fn render_resources<D>(&self, display: &mut D, status: &SystemStatus) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = Rgb888>,
    {
        let panel_y = 220;
        let panel_height = 130;
        let panel_width = self.width - 2 * self.padding;

        // Panel background
        RoundedRectangle::with_equal_corners(
            Rectangle::new(
                Point::new(self.padding as i32, panel_y),
                Size::new(panel_width, panel_height),
            ),
            Size::new(8, 8),
        )
        .into_styled(PrimitiveStyle::with_fill(BG_PANEL))
        .draw(display)?;

        let label_style = MonoTextStyle::new(&FONT_9X18, TEXT_MUTED);
        let value_style = MonoTextStyle::new(&FONT_9X18, TEXT_PRIMARY);

        let label_x = (self.padding + 20) as i32;
        let bar_x = (self.padding + 100) as i32;
        let bar_width = (panel_width - 200) as u32;
        let bar_height = 16;
        let mut y = panel_y as i32 + 35;

        // CPU
        Text::new("CPU:", Point::new(label_x, y), label_style).draw(display)?;
        self.render_progress_bar(display, bar_x, y - 12, bar_width, bar_height, status.cpu_percent)?;
        let cpu_text = format!("{:.0}%", status.cpu_percent);
        Text::new(&cpu_text, Point::new(bar_x + bar_width as i32 + 15, y), value_style).draw(display)?;

        y += self.line_height as i32 + 5;

        // Memory
        Text::new("Memory:", Point::new(label_x, y), label_style).draw(display)?;
        self.render_progress_bar(display, bar_x, y - 12, bar_width, bar_height, status.memory_percent)?;
        let mem_text = format!(
            "{:.0}%  ({} / {})",
            status.memory_percent, status.memory_used, status.memory_total
        );
        Text::new(&mem_text, Point::new(bar_x + bar_width as i32 + 15, y), value_style).draw(display)?;

        y += self.line_height as i32 + 5;

        // VMs
        Text::new("VMs:", Point::new(label_x, y), label_style).draw(display)?;
        let vm_color = if status.vm_count > 0 { ACCENT_GREEN } else { TEXT_MUTED };
        let vm_style = MonoTextStyle::new(&FONT_9X18, vm_color);
        let vm_text = format!("{} running", status.vm_count);
        Text::new(&vm_text, Point::new(bar_x, y), vm_style).draw(display)?;

        // SSH status
        let ssh_x = (self.width / 2) as i32;
        Text::new("SSH:", Point::new(ssh_x, y), label_style).draw(display)?;
        let (ssh_text, ssh_color) = if status.ssh_enabled {
            ("Enabled", ACCENT_GREEN)
        } else {
            ("Disabled", TEXT_MUTED)
        };
        let ssh_style = MonoTextStyle::new(&FONT_9X18, ssh_color);
        Text::new(ssh_text, Point::new(ssh_x + 50, y), ssh_style).draw(display)?;

        Ok(())
    }

    /// Render a progress bar
    fn render_progress_bar<D>(
        &self,
        display: &mut D,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        percent: f32,
    ) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = Rgb888>,
    {
        // Background
        RoundedRectangle::with_equal_corners(
            Rectangle::new(Point::new(x, y), Size::new(width, height)),
            Size::new(4, 4),
        )
        .into_styled(PrimitiveStyle::with_fill(PROGRESS_BG))
        .draw(display)?;

        // Fill
        let fill_width = ((width as f32 * percent / 100.0) as u32).min(width);
        if fill_width > 0 {
            let fill_color = if percent > 90.0 {
                ACCENT_RED
            } else if percent > 70.0 {
                ACCENT_YELLOW
            } else {
                PROGRESS_FILL
            };

            RoundedRectangle::with_equal_corners(
                Rectangle::new(Point::new(x, y), Size::new(fill_width, height)),
                Size::new(4, 4),
            )
            .into_styled(PrimitiveStyle::with_fill(fill_color))
            .draw(display)?;
        }

        Ok(())
    }

    /// Render the function key menu bar
    fn render_menu_bar<D>(&self, display: &mut D) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = Rgb888>,
    {
        let bar_height = 50;
        let bar_y = self.height - bar_height - self.padding;

        // Menu bar background
        RoundedRectangle::with_equal_corners(
            Rectangle::new(
                Point::new(self.padding as i32, bar_y as i32),
                Size::new(self.width - 2 * self.padding, bar_height),
            ),
            Size::new(8, 8),
        )
        .into_styled(PrimitiveStyle::with_fill(BG_MENU))
        .draw(display)?;

        let key_style = MonoTextStyle::new(&FONT_9X18, ACCENT_CYAN);
        let label_style = MonoTextStyle::new(&FONT_9X18, TEXT_PRIMARY);

        // Calculate spacing
        let total_items = MENU_ITEMS.len() as u32;
        let item_width = (self.width - 2 * self.padding) / total_items;
        let text_y = (bar_y + bar_height / 2 + 6) as i32;

        for (i, item) in MENU_ITEMS.iter().enumerate() {
            let x = (self.padding + i as u32 * item_width + 15) as i32;

            // Key in brackets
            let key_text = format!("[{}]", item.key);
            Text::new(&key_text, Point::new(x, text_y), key_style).draw(display)?;

            // Label after key
            let label_x = x + (key_text.len() as i32 + 1) * 9;
            Text::new(item.label, Point::new(label_x, text_y), label_style).draw(display)?;
        }

        Ok(())
    }

    /// Render a confirmation dialog
    pub fn render_confirm_dialog<D>(
        &self,
        display: &mut D,
        title: &str,
        message: &str,
        is_danger: bool,
    ) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = Rgb888>,
    {
        let dialog_width = 500;
        let dialog_height = 180;
        let dialog_x = ((self.width - dialog_width) / 2) as i32;
        let dialog_y = ((self.height - dialog_height) / 2) as i32;

        // Semi-transparent overlay (just draw a dark rectangle)
        Rectangle::new(Point::zero(), Size::new(self.width, self.height))
            .into_styled(PrimitiveStyle::with_fill(Rgb888::new(0, 0, 0)))
            .draw(display)?;

        // Dialog background
        RoundedRectangle::with_equal_corners(
            Rectangle::new(
                Point::new(dialog_x, dialog_y),
                Size::new(dialog_width, dialog_height),
            ),
            Size::new(12, 12),
        )
        .into_styled(PrimitiveStyle::with_fill(BG_DIALOG))
        .draw(display)?;

        // Border
        let border_color = if is_danger { ACCENT_RED } else { ACCENT_CYAN };
        RoundedRectangle::with_equal_corners(
            Rectangle::new(
                Point::new(dialog_x, dialog_y),
                Size::new(dialog_width, dialog_height),
            ),
            Size::new(12, 12),
        )
        .into_styled(PrimitiveStyle::with_stroke(border_color, 2))
        .draw(display)?;

        // Title
        let title_style = MonoTextStyle::new(&FONT_10X20, if is_danger { ACCENT_RED } else { TEXT_BRIGHT });
        Text::with_alignment(
            title,
            Point::new(dialog_x + (dialog_width / 2) as i32, dialog_y + 40),
            title_style,
            Alignment::Center,
        )
        .draw(display)?;

        // Message
        let msg_style = MonoTextStyle::new(&FONT_9X18, TEXT_PRIMARY);
        Text::with_alignment(
            message,
            Point::new(dialog_x + (dialog_width / 2) as i32, dialog_y + 80),
            msg_style,
            Alignment::Center,
        )
        .draw(display)?;

        // Buttons hint
        let hint_style = MonoTextStyle::new(&FONT_9X18, TEXT_MUTED);
        Text::with_alignment(
            "[Enter] Confirm    [Esc] Cancel",
            Point::new(dialog_x + (dialog_width / 2) as i32, dialog_y + 140),
            hint_style,
            Alignment::Center,
        )
        .draw(display)?;

        Ok(())
    }

    /// Render an authentication dialog
    pub fn render_auth_dialog<D>(
        &self,
        display: &mut D,
        username: &str,
        password_len: usize,
        error: bool,
        active_field: u8, // 0 = username, 1 = password
    ) -> Result<(), D::Error>
    where
        D: DrawTarget<Color = Rgb888>,
    {
        let dialog_width = 450;
        let dialog_height = 220;
        let dialog_x = ((self.width - dialog_width) / 2) as i32;
        let dialog_y = ((self.height - dialog_height) / 2) as i32;

        // Overlay
        Rectangle::new(Point::zero(), Size::new(self.width, self.height))
            .into_styled(PrimitiveStyle::with_fill(Rgb888::new(0, 0, 0)))
            .draw(display)?;

        // Dialog background
        RoundedRectangle::with_equal_corners(
            Rectangle::new(
                Point::new(dialog_x, dialog_y),
                Size::new(dialog_width, dialog_height),
            ),
            Size::new(12, 12),
        )
        .into_styled(PrimitiveStyle::with_fill(BG_DIALOG))
        .draw(display)?;

        // Border
        RoundedRectangle::with_equal_corners(
            Rectangle::new(
                Point::new(dialog_x, dialog_y),
                Size::new(dialog_width, dialog_height),
            ),
            Size::new(12, 12),
        )
        .into_styled(PrimitiveStyle::with_stroke(ACCENT_CYAN, 2))
        .draw(display)?;

        // Title
        let title_style = MonoTextStyle::new(&FONT_10X20, TEXT_BRIGHT);
        Text::with_alignment(
            "Authentication Required",
            Point::new(dialog_x + (dialog_width / 2) as i32, dialog_y + 35),
            title_style,
            Alignment::Center,
        )
        .draw(display)?;

        let label_style = MonoTextStyle::new(&FONT_9X18, TEXT_MUTED);
        let input_style = MonoTextStyle::new(&FONT_9X18, TEXT_PRIMARY);
        let input_x = dialog_x + 30;
        let input_width = dialog_width - 60;
        let input_height = 28;

        // Username field
        let mut y = dialog_y + 65;
        Text::new("Username:", Point::new(input_x, y), label_style).draw(display)?;
        y += 5;

        let username_bg = if active_field == 0 { BG_INPUT } else { PROGRESS_BG };
        let username_border = if active_field == 0 { ACCENT_CYAN } else { BORDER_LIGHT };
        RoundedRectangle::with_equal_corners(
            Rectangle::new(Point::new(input_x, y), Size::new(input_width as u32, input_height)),
            Size::new(4, 4),
        )
        .into_styled(PrimitiveStyle::with_fill(username_bg))
        .draw(display)?;
        RoundedRectangle::with_equal_corners(
            Rectangle::new(Point::new(input_x, y), Size::new(input_width as u32, input_height)),
            Size::new(4, 4),
        )
        .into_styled(PrimitiveStyle::with_stroke(username_border, 1))
        .draw(display)?;
        Text::new(username, Point::new(input_x + 8, y + 20), input_style).draw(display)?;

        // Password field
        y += input_height as i32 + 20;
        Text::new("Password:", Point::new(input_x, y), label_style).draw(display)?;
        y += 5;

        let password_bg = if active_field == 1 { BG_INPUT } else { PROGRESS_BG };
        let password_border = if active_field == 1 { ACCENT_CYAN } else { BORDER_LIGHT };
        RoundedRectangle::with_equal_corners(
            Rectangle::new(Point::new(input_x, y), Size::new(input_width as u32, input_height)),
            Size::new(4, 4),
        )
        .into_styled(PrimitiveStyle::with_fill(password_bg))
        .draw(display)?;
        RoundedRectangle::with_equal_corners(
            Rectangle::new(Point::new(input_x, y), Size::new(input_width as u32, input_height)),
            Size::new(4, 4),
        )
        .into_styled(PrimitiveStyle::with_stroke(password_border, 1))
        .draw(display)?;
        let password_mask: String = "*".repeat(password_len);
        Text::new(&password_mask, Point::new(input_x + 8, y + 20), input_style).draw(display)?;

        // Error message
        if error {
            let error_style = MonoTextStyle::new(&FONT_9X18, ACCENT_RED);
            Text::with_alignment(
                "Invalid credentials",
                Point::new(dialog_x + (dialog_width / 2) as i32, y + input_height as i32 + 20),
                error_style,
                Alignment::Center,
            )
            .draw(display)?;
        }

        // Buttons hint
        let hint_style = MonoTextStyle::new(&FONT_9X18, TEXT_MUTED);
        Text::with_alignment(
            "[Tab] Switch Field    [Enter] Submit    [Esc] Cancel",
            Point::new(dialog_x + (dialog_width / 2) as i32, dialog_y + dialog_height as i32 - 20),
            hint_style,
            Alignment::Center,
        )
        .draw(display)?;

        Ok(())
    }
}
