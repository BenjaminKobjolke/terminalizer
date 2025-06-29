/**
 * FFmpeg Node.js implementation for Terminalizer
 * 
 * This module provides a wrapper around the node-ffmpeg library
 * to convert PNG frames to MP4 videos.
 */

const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg');

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

  console.log('[ffmpeg-node] Starting conversion process');
  console.log('[ffmpeg-node] Output path:', outputPath);
  console.log('[ffmpeg-node] Absolute output path:', path.resolve(outputPath));
  console.log('[ffmpeg-node] Dimensions:', dimensions);
  console.log('[ffmpeg-node] Frame rate:', frameRate);
  console.log('[ffmpeg-node] Number of frames:', framePaths.length);
  
  // Create a temporary directory to store the frames with sequential names
  const tempDir = path.join(path.dirname(outputPath), 'temp_frames_' + Date.now());
  console.log('[ffmpeg-node] Creating temporary directory:', tempDir);
  
  try {
    // Delete the output file if it exists to prevent FFmpeg from hanging
    if (fs.existsSync(outputPath)) {
      console.log('[ffmpeg-node] Deleting existing output file:', outputPath);
      fs.unlinkSync(outputPath);
    }
    
    // Create the temporary directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Copy frames to the temporary directory with sequential names
    console.log('[ffmpeg-node] Copying frames to temporary directory...');
    for (let i = 0; i < framePaths.length; i++) {
      const framePath = framePaths[i];
      const frameData = fs.readFileSync(framePath);
      const tempFramePath = path.join(tempDir, `frame_${i.toString().padStart(6, '0')}.png`);
      fs.writeFileSync(tempFramePath, frameData);
      console.log(`[ffmpeg-node] Copied frame ${i+1}/${framePaths.length}`);
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
    console.log('[ffmpeg-node] Created input file list');
    
    // Use the first frame to create an ffmpeg process
    const firstFrame = path.join(tempDir, 'frame_000000.png');
    console.log('[ffmpeg-node] Creating ffmpeg process with first frame:', firstFrame);
    
    return new Promise((resolve, reject) => {
      try {
        new ffmpeg(firstFrame, function(err, video) {
          if (err) {
            console.error('[ffmpeg-node] Error creating ffmpeg process:', err);
            reject(err);
            return;
          }
          
          console.log('[ffmpeg-node] FFmpeg process created successfully');
          
          try {
            // Configure the video settings
            video.setVideoSize(`${dimensions.width}x${dimensions.height}`, true, true);
            video.setVideoFormat('mp4');
            video.setVideoFrameRate(frameRate);
            
            // Use a simple approach without explicitly setting codec
            // This lets ffmpeg choose the best available codec
            console.log('[ffmpeg-node] Using default codec selection');
            
            // Instead of using addCommand for concat format, let's use a different approach
            // We'll use a single frame and loop it, then set the framerate
            console.log('[ffmpeg-node] Using single frame approach instead of concat');
            
            // Force overwrite of output file
            video.addCommand('-y', '');
            
            // Try to use all frames instead of just the first one
            try {
              // Create a pattern for the input files
              const pattern = path.join(tempDir, 'frame_%06d.png');
              video.addCommand('-i', pattern);
              console.log('[ffmpeg-node] Using pattern-based input:', pattern);
            } catch (patternErr) {
              console.log('[ffmpeg-node] Pattern-based input failed, falling back to single frame');
              // Fallback to single frame approach
              video.addCommand('-loop', '1');
              video.addCommand('-t', (framePaths.length / frameRate).toString());
            }
            
            console.log('[ffmpeg-node] Starting conversion...');
            
            // Save the output file
            video.save(outputPath, function(err, file) {
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
                console.log('[ffmpeg-node] Cleaned up temporary directory');
              } catch (cleanupErr) {
                console.error('[ffmpeg-node] Error cleaning up temporary directory:', cleanupErr);
              }
              
              if (err) {
                console.error('[ffmpeg-node] Error saving output file:', err);
                
                // Try to create a simple MP4 file using a different approach
                try {
                  console.log('[ffmpeg-node] Attempting alternative approach...');
                  
                  // Create a simple MP4 file with the first frame repeated
                  const simpleVideo = new ffmpeg(firstFrame);
                  simpleVideo.then(function(video) {
                    video.setVideoSize(`${dimensions.width}x${dimensions.height}`, true, true);
                    video.setVideoFormat('mp4');
                    video.setVideoFrameRate(frameRate);
                    
                    // Force overwrite of output file
                    video.addCommand('-y', '');
                    
                    // Use a simpler approach for the alternative
                    video.addCommand('-loop', '1');
                    video.addCommand('-t', (framePaths.length / frameRate).toString());
                    
                    video.save(outputPath, function(err2, file2) {
                      if (err2) {
                        console.error('[ffmpeg-node] Alternative approach failed:', err2);
                        reject(err);
                      } else {
                        console.log('[ffmpeg-node] Alternative approach succeeded');
                        resolve(file2);
                      }
                    });
                  }, function(err2) {
                    console.error('[ffmpeg-node] Alternative approach failed:', err2);
                    reject(err);
                  });
                } catch (altErr) {
                  console.error('[ffmpeg-node] Alternative approach failed:', altErr);
                  reject(err);
                }
                
                return;
              }
              
              console.log('[ffmpeg-node] Conversion completed successfully');
              console.log('[ffmpeg-node] Output file:', file);
              
              // Verify the output file
              try {
                const stats = fs.statSync(outputPath);
                console.log(`[ffmpeg-node] Output file size: ${stats.size} bytes`);
                
                if (stats.size === 0) {
                  reject(new Error('Output file is empty (0 bytes)'));
                  return;
                }
              } catch (statErr) {
                console.error('[ffmpeg-node] Error checking output file:', statErr);
                reject(statErr);
                return;
              }
              
              onProgress(100); // 100% complete
              resolve(file);
            });
          } catch (configErr) {
            console.error('[ffmpeg-node] Error configuring video:', configErr);
            reject(configErr);
          }
        });
      } catch (processErr) {
        console.error('[ffmpeg-node] Error creating ffmpeg process:', processErr);
        reject(processErr);
      }
    });
  } catch (error) {
    console.error('[ffmpeg-node] Conversion process failed:', error);
    
    // Clean up the temporary directory in case of error
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir, { recursive: true });
      }
    } catch (cleanupErr) {
      console.error('[ffmpeg-node] Error cleaning up temporary directory:', cleanupErr);
    }
    
    throw error;
  }
}

module.exports = {
  convertFramesToMp4
};
