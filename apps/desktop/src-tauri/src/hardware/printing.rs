use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;

const PRINT_ERROR: &str = "PRINT_FAILED";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJob {
    printer: String,
    width: usize,
    height: usize,
    raster: String,
    escpos: bool,
    cut: bool,
    drawer: bool,
}

fn validate_printer(name: &str, installed: &[String]) -> Result<(), &'static str> {
    if name.is_empty()
        || name.contains('\0')
        || name.starts_with("\\\\")
        || name.chars().any(char::is_control)
        || !installed.iter().any(|candidate| candidate == name)
    {
        return Err(PRINT_ERROR);
    }
    Ok(())
}

impl PrintJob {
    pub fn print(self) -> Result<(), &'static str> {
        if !matches!(self.width, 384 | 576)
            || !(1..=8000).contains(&self.height)
            || self.raster.len() > 800_000
        {
            return Err(PRINT_ERROR);
        }
        let installed = windows::printers()?;
        validate_printer(&self.printer, &installed)?;
        let image = STANDARD.decode(self.raster).map_err(|_| PRINT_ERROR)?;
        if image.len() != self.width / 8 * self.height {
            return Err(PRINT_ERROR);
        }
        if self.escpos {
            windows::raw(
                &self.printer,
                &escpos(&image, self.width, self.cut, self.drawer),
            )
        } else {
            windows::bitmap(&self.printer, &image, self.width, self.height)
        }
    }
}

fn escpos(image: &[u8], width: usize, cut: bool, drawer: bool) -> Vec<u8> {
    let stride = width / 8;
    let mut result = vec![0x1b, b'@'];
    for band in image.chunks(stride * 192) {
        let height = band.len() / stride;
        result.extend([0x1d, b'v', b'0', 0, stride as u8, 0, height as u8, 0]);
        result.extend_from_slice(band);
    }
    result.extend([b'\n', b'\n', b'\n']);
    if cut {
        result.extend([0x1d, b'V', 0]);
    }
    if drawer {
        result.extend([0x1b, b'p', 0, 25, 250]);
    }
    result
}

pub fn printers() -> Result<Vec<String>, &'static str> {
    windows::printers()
}

mod windows {
    use super::PRINT_ERROR;
    use std::{
        ffi::c_void,
        mem::size_of,
        ptr::{null, null_mut},
    };

    type Handle = *mut c_void;
    #[repr(C)]
    struct PrinterInfo4 {
        name: *const u16,
        server: *const u16,
        attributes: u32,
    }
    #[repr(C)]
    struct RawDoc {
        name: *const u16,
        output: *const u16,
        data_type: *const u16,
    }
    #[repr(C)]
    struct GdiDoc {
        size: i32,
        name: *const u16,
        output: *const u16,
        data_type: *const u16,
        flags: u32,
    }
    #[repr(C)]
    struct BitmapInfo {
        size: u32,
        width: i32,
        height: i32,
        planes: u16,
        bits: u16,
        compression: u32,
        image_size: u32,
        x_pixels: i32,
        y_pixels: i32,
        colors_used: u32,
        colors_important: u32,
    }

    #[link(name = "winspool")]
    extern "system" {
        fn EnumPrintersW(
            flags: u32,
            name: *const u16,
            level: u32,
            buffer: *mut u8,
            size: u32,
            needed: *mut u32,
            returned: *mut u32,
        ) -> i32;
        fn OpenPrinterW(name: *const u16, handle: *mut Handle, defaults: *mut c_void) -> i32;
        fn ClosePrinter(handle: Handle) -> i32;
        fn StartDocPrinterW(handle: Handle, level: u32, doc: *const RawDoc) -> u32;
        fn EndDocPrinter(handle: Handle) -> i32;
        fn AbortPrinter(handle: Handle) -> i32;
        fn StartPagePrinter(handle: Handle) -> i32;
        fn EndPagePrinter(handle: Handle) -> i32;
        fn WritePrinter(handle: Handle, data: *const u8, count: u32, written: *mut u32) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateDCW(
            driver: *const u16,
            device: *const u16,
            port: *const u16,
            mode: *const c_void,
        ) -> Handle;
        fn DeleteDC(device: Handle) -> i32;
        fn StartDocW(device: Handle, info: *const GdiDoc) -> i32;
        fn EndDoc(device: Handle) -> i32;
        fn AbortDoc(device: Handle) -> i32;
        fn StartPage(device: Handle) -> i32;
        fn EndPage(device: Handle) -> i32;
        fn GetDeviceCaps(device: Handle, index: i32) -> i32;
        fn StretchDIBits(
            device: Handle,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            source_x: i32,
            source_y: i32,
            source_width: i32,
            source_height: i32,
            buffer: *const u8,
            info: *const BitmapInfo,
            usage: u32,
            operation: u32,
        ) -> i32;
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain([0]).collect()
    }

    pub fn printers() -> Result<Vec<String>, &'static str> {
        const LOCAL_AND_CONNECTIONS: u32 = 0x2 | 0x4;
        let mut needed = 0;
        let mut returned = 0;
        unsafe {
            EnumPrintersW(
                LOCAL_AND_CONNECTIONS,
                null(),
                4,
                null_mut(),
                0,
                &mut needed,
                &mut returned,
            );
            if needed == 0 {
                return Ok(Vec::new());
            }
            let mut data = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
            if EnumPrintersW(
                LOCAL_AND_CONNECTIONS,
                null(),
                4,
                data.as_mut_ptr().cast(),
                needed,
                &mut needed,
                &mut returned,
            ) == 0
            {
                return Err(PRINT_ERROR);
            }
            let mut names = Vec::new();
            for entry in
                std::slice::from_raw_parts(data.as_ptr().cast::<PrinterInfo4>(), returned as usize)
            {
                if entry.name.is_null() {
                    continue;
                }
                let mut count = 0;
                while *entry.name.add(count) != 0 {
                    count += 1;
                }
                names.push(String::from_utf16_lossy(std::slice::from_raw_parts(
                    entry.name, count,
                )));
            }
            names.sort();
            names.dedup();
            Ok(names)
        }
    }

    pub fn raw(printer: &str, data: &[u8]) -> Result<(), &'static str> {
        let mut handle = null_mut();
        let name = wide(printer);
        let title = wide("The POS Receipt");
        let raw = wide("RAW");
        let doc = RawDoc {
            name: title.as_ptr(),
            output: null(),
            data_type: raw.as_ptr(),
        };
        unsafe {
            if OpenPrinterW(name.as_ptr(), &mut handle, null_mut()) == 0 {
                return Err(PRINT_ERROR);
            }
            if StartDocPrinterW(handle, 1, &doc) == 0 {
                ClosePrinter(handle);
                return Err(PRINT_ERROR);
            }
            let mut written = 0;
            let success = StartPagePrinter(handle) != 0
                && WritePrinter(handle, data.as_ptr(), data.len() as u32, &mut written) != 0
                && written == data.len() as u32
                && EndPagePrinter(handle) != 0
                && EndDocPrinter(handle) != 0;
            if !success {
                AbortPrinter(handle);
            }
            ClosePrinter(handle);
            success.then_some(()).ok_or(PRINT_ERROR)
        }
    }

    pub fn bitmap(
        printer: &str,
        raster: &[u8],
        width: usize,
        height: usize,
    ) -> Result<(), &'static str> {
        let driver = wide("WINSPOOL");
        let name = wide(printer);
        let title = wide("The POS Receipt");
        let doc = GdiDoc {
            size: size_of::<GdiDoc>() as i32,
            name: title.as_ptr(),
            output: null(),
            data_type: null(),
            flags: 0,
        };
        unsafe {
            let device = CreateDCW(driver.as_ptr(), name.as_ptr(), null(), null());
            if device.is_null() {
                return Err(PRINT_ERROR);
            }
            if StartDocW(device, &doc) <= 0 {
                DeleteDC(device);
                return Err(PRINT_ERROR);
            }
            let printable_width = GetDeviceCaps(device, 8);
            let printable_height = GetDeviceCaps(device, 10);
            let dpi = GetDeviceCaps(device, 88);
            let display_width = ((width as i64 * dpi as i64) / 203).min(printable_width as i64 - 4) as i32;
            let usable_height = printable_height - 8;
            let success = display_width > 0
                && usable_height > 0
                && draw_pages(
                    device,
                    raster,
                    width,
                    height,
                    display_width,
                    usable_height,
                    printable_width,
                )
                && EndDoc(device) > 0;
            if !success {
                AbortDoc(device);
            }
            DeleteDC(device);
            success.then_some(()).ok_or(PRINT_ERROR)
        }
    }

    fn draw_pages(
        device: Handle,
        raster: &[u8],
        width: usize,
        height: usize,
        display_width: i32,
        usable_height: i32,
        printable_width: i32,
    ) -> bool {
        let stride = width / 8;
        let rows_per_page =
            ((i64::from(usable_height) * width as i64) / i64::from(display_width)).max(1) as usize;
        for start in (0..height).step_by(rows_per_page) {
            let end = (start + rows_per_page).min(height);
            let rows = end - start;
            let mut bitmap = Vec::with_capacity(rows * width * 3);
            for byte in &raster[start * stride..end * stride] {
                for shift in (0..8).rev() {
                    let color = if byte & (1 << shift) == 0 { 255 } else { 0 };
                    bitmap.extend([color; 3]);
                }
            }
            let info = BitmapInfo {
                size: size_of::<BitmapInfo>() as u32,
                width: width as i32,
                height: -(rows as i32),
                planes: 1,
                bits: 24,
                compression: 0,
                image_size: bitmap.len() as u32,
                x_pixels: 0,
                y_pixels: 0,
                colors_used: 0,
                colors_important: 0,
            };
            let display_height = ((rows as i64 * display_width as i64) / width as i64).max(1) as i32;
            unsafe {
                if StartPage(device) <= 0
                    || StretchDIBits(
                        device,
                        (printable_width - display_width) / 2,
                        4,
                        display_width,
                        display_height,
                        0,
                        0,
                        width as i32,
                        rows as i32,
                        bitmap.as_ptr(),
                        &info,
                        0,
                        0x00cc0020,
                    ) <= 0
                    || EndPage(device) <= 0
                {
                    return false;
                }
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{escpos, validate_printer};

    #[test]
    fn writes_raster_bands_and_pulses_only_when_requested() {
        let data = vec![0x80; 48 * 193];
        let printed = escpos(&data, 384, true, true);
        assert_eq!(&printed[..10], &[27, 64, 29, 118, 48, 0, 48, 0, 192, 0]);
        assert_eq!(
            &printed[10 + 48 * 192..18 + 48 * 192],
            &[29, 118, 48, 0, 48, 0, 1, 0]
        );
        assert!(printed.ends_with(&[29, 86, 0, 27, 112, 0, 25, 250]));
        assert!(escpos(&[0; 72], 576, false, false).ends_with(&[10, 10, 10]));
    }

    #[test]
    fn rejects_unc_or_unregistered_printers() {
        let installed = vec!["POS-80".to_owned(), "XP-58".to_owned()];
        assert!(validate_printer("POS-80", &installed).is_ok());
        assert!(validate_printer("\\\\attacker\\share", &installed).is_err());
        assert!(validate_printer("Microsoft Print to PDF", &installed).is_err());
        assert!(validate_printer("POS-80\n", &installed).is_err());
        assert!(validate_printer("", &installed).is_err());
    }
}
