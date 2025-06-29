/**
 * FFmpeg Direct Implementation for Terminalizer
 * 
 * This module provides a direct wrapper around the FFmpeg command-line tool
 * to convert PNG frames to MP4 videos.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Convert a series of PNG frames to an MP4 video
 * 
 * @param {Object} options Configuration options
 * @param {Array<string>} options.framePaths Array of paths to PNG frame files
 * @param {string} options.outputPath Path to save the output MP4 file
 * @param {Object} options.dimensions Width and height of the frames
 * @param {number} options.dimensions.width Width of the frames
 * @param {number} options.dimensions.height Height of the frames
 * @param {number} options.frameRate Frame rate of the output video (default: 30)
 * @param {Function} options.onProgress Progress callback function
 * @returns {Promise<void>} Promise that resolves when the conversion is complete
 */
async function convertFramesToMp4(options) {
  const {
    framePaths,
    outputPath,
    dimensions,
    frameRate = 30,
    onProgress = () => {}
  } = options;

  console.log('[ffmpeg-direct] Starting conversion process');
  console.log('[ffmpeg-direct] Output path:', outputPath);
  console.log('[ffmpeg-direct] Absolute output path:', path.resolve(outputPath));
  console.log('[ffmpeg-direct] Dimensions:', dimensions);
  console.log('[ffmpeg-direct] Frame rate:', frameRate);
  console.log('[ffmpeg-direct] Number of frames:', framePaths.length);
  
  // Create a temporary directory to store the frames with sequential names
  const tempDir = path.join(path.dirname(outputPath), 'temp_frames_' + Date.now());
  console.log('[ffmpeg-direct] Creating temporary directory:', tempDir);
  
  try {
    // Delete the output file if it exists to prevent FFmpeg from hanging
    if (fs.existsSync(outputPath)) {
      console.log('[ffmpeg-direct] Deleting existing output file:', outputPath);
      fs.unlinkSync(outputPath);
    }
    
    // Create the temporary directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Copy frames to the temporary directory with sequential names
    console.log('[ffmpeg-direct] Copying frames to temporary directory...');
    for (let i = 0; i < framePaths.length; i++) {
      const framePath = framePaths[i];
      const frameData = fs.readFileSync(framePath);
      const tempFramePath = path.join(tempDir, `frame_${i.toString().padStart(6, '0')}.png`);
      fs.writeFileSync(tempFramePath, frameData);
      console.log(`[ffmpeg-direct] Copied frame ${i+1}/${framePaths.length}`);
      onProgress((i / framePaths.length) * 50); // First 50% is copying frames
    }
    
    // Create a text file with the list of frames
    const inputFile = path.join(tempDir, 'input.txt');
    let inputContent = '';
    for (let i = 0; i < framePaths.length; i++) {
      const tempFramePath = path.join(tempDir, `frame_${i.toString().padStart(6, '0')}.png`);
      inputContent += `file '${tempFramePath.replace(/\\/g, '/')}'\n`;
    }
    fs.writeFileSync(inputFile, inputContent);
    console.log('[ffmpeg-direct] Created input file list');
    
    return new Promise((resolve, reject) => {
      // Find ffmpeg executable
      let ffmpegPath = 'ffmpeg'; // Default to system path
      
      // Check common installation locations
      const possiblePaths = [
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        process.env.USERPROFILE + '\\scoop\\apps\\ffmpeg\\current\\bin\\ffmpeg.exe'
      ];
      
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          ffmpegPath = possiblePath;
          console.log('[ffmpeg-direct] Found FFmpeg at:', ffmpegPath);
          break;
        }
      }
      
      // Instead of using concat format, use pattern-based input with image2
      // This approach is more reliable for frame sequences
      const ffmpegArgs = [
        '-y', // Force overwrite output file
        '-framerate', frameRate.toString(), // Input frame rate (IMPORTANT: must be before -i)
        '-i', path.join(tempDir, 'frame_%06d.png'), // Pattern-based input
        '-c:v', 'libx264', // Video codec
        '-pix_fmt', 'yuv420p', // Pixel format for compatibility
        '-vf', `scale=${dimensions.width}:${dimensions.height}`, // Scale to dimensions
        outputPath // Output file
      ];
      
      console.log('[ffmpeg-direct] Executing FFmpeg command:', ffmpegPath, ffmpegArgs.join(' '));
      
      // Execute FFmpeg command
      const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
      
      let stdoutData = '';
      let stderrData = '';
      
      ffmpegProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
        console.log('[ffmpeg-direct] stdout:', data.toString());
      });
      
      ffmpegProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
        console.log('[ffmpeg-direct] stderr:', data.toString());
        
        // Try to parse progress information
        const progressMatch = data.toString().match(/frame=\s*(\d+)/);
        if (progressMatch && progressMatch[1]) {
          const frame = parseInt(progressMatch[1]);
          const percent = 50 + (frame / framePaths.length) * 50; // Second 50% is FFmpeg processing
          onProgress(Math.min(percent, 100));
        }
      });
      
      ffmpegProcess.on('close', (code) => {
        // Clean up the temporary directory
        try {
          for (let i = 0; i < framePaths.length; i++) {
            const tempFramePath = path.join(tempDir, `frame_${i.toString().padStart(6, '0')}.png`);
            if (fs.existsSync(tempFramePath)) {
              fs.unlinkSync(tempFramePath);
            }
          }
          if (fs.existsSync(inputFile)) {
            fs.unlinkSync(inputFile);
          }
          if (fs.existsSync(tempDir)) {
            fs.rmdirSync(tempDir);
          }
          console.log('[ffmpeg-direct] Cleaned up temporary directory');
        } catch (cleanupErr) {
          console.error('[ffmpeg-direct] Error cleaning up temporary directory:', cleanupErr);
        }
        
        if (code !== 0) {
          console.error(`[ffmpeg-direct] FFmpeg process exited with code ${code}`);
          console.error('[ffmpeg-direct] stderr:', stderrData);
          reject(new Error(`FFmpeg process exited with code ${code}`));
          return;
        }
        
        // Verify the output file
        try {
          const stats = fs.statSync(outputPath);
          console.log(`[ffmpeg-direct] Output file size: ${stats.size} bytes`);
          
          if (stats.size === 0) {
            reject(new Error('Output file is empty (0 bytes)'));
            return;
          }
          
          console.log('[ffmpeg-direct] Conversion completed successfully');
          onProgress(100); // 100% complete
          resolve(outputPath);
        } catch (statErr) {
          console.error('[ffmpeg-direct] Error checking output file:', statErr);
          reject(statErr);
        }
      });
      
      ffmpegProcess.on('error', (err) => {
        console.error('[ffmpeg-direct] Failed to start FFmpeg process:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('[ffmpeg-direct] Conversion process failed:', error);
    
    // Clean up the temporary directory in case of error
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir, { recursive: true });
      }
    } catch (cleanupErr) {
      console.error('[ffmpeg-direct] Error cleaning up temporary directory:', cleanupErr);
    }
    
    throw error;
  }
}

module.exports = {
  convertFramesToMp4
};
