/**
 * Render
 * Render a recording file as an animated gif image or mp4 video
 *
 * @author Mohammad Fares <faressoft.com@gmail.com>
 */

const tmp = require('tmp');
// Import the ffmpeg-direct module for direct FFmpeg command execution
const { convertFramesToMp4 } = require('../render/src/js/ffmpeg-direct');

tmp.setGracefulCleanup();

/**
 * The directory to render the frames into
 */
var renderDir = tmp.dirSync({ unsafeCleanup: true }).name;

/**
 * Create a progress bar for processing frames
 *
 * @param  {String}      operation   a name for the operation
 * @param  {Number}      framesCount
 * @return {ProgressBar}
 */
function getProgressBar(operation, framesCount) {
  return new di.ProgressBar(
    operation +
      " " +
      di.chalk.magenta("frame :current/:total") +
      " :percent [:bar] :etas",
    {
      width: 30,
      total: framesCount,
    }
  );
}

/**
 * Write the recording data into render/data.json
 *
 * @param  {Object}  recordingFile
 * @return {Promise}
 */
function writeRecordingData(recordingFile) {
  return new Promise(function (resolve, reject) {
    // Write the data into data.json file in the root path of the app
    di.fs.writeFile(
      di.path.join(ROOT_PATH, "render/data.json"),
      JSON.stringify(recordingFile.json),
      "utf8",
      function (error) {
        if (error) {
          return reject(error);
        }

        resolve();
      }
    );
  });
}

/**
 * Read and parse a PNG image file
 *
 * @param  {String}  path the absolute path of the image
 * @return {Promise} resolve with the parsed PNG image
 */
function loadPNG(path) {
  return new Promise(function (resolve, reject) {
    di.fs.readFile(path, function (error, imageData) {
      if (error) {
        return reject(error);
      }

      new di.PNG().parse(imageData, function (error, data) {
        if (error) {
          return reject(error);
        }

        resolve(data);
      });
    });
  });
}

/**
 * Get the dimensions of the first rendered frame
 *
 * @return {Promise}
 */
function getFrameDimensions() {
  // The path of the first rendered frame
  var framePath = di.path.join(renderDir, "0.png");

  // Read and parse a PNG image file
  return loadPNG(framePath).then(function (png) {
    return {
      width: png.width,
      height: png.height,
    };
  });
}
/**
 * Render the frames into PNG images
 *
 * @param  {Array}   records [{delay, content}, ...]
 * @param  {Object}  options {step}
 * @return {Promise}
 */
function renderFrames(records, options) {
  return new Promise(function (resolve, reject) {
    // The number of frames
    var framesCount = records.length;

    // Track execution time
    var start = Date.now();

    // Create a progress bar
    var progressBar = getProgressBar(
      "Rendering",
      Math.ceil(framesCount / options.step)
    );

    // Execute the rendering process
    var render = di.spawn(
      di.electron,
      [di.path.join(ROOT_PATH, "render/index.js"), renderDir, options.step,],
      { detached: false }
    );

    render.stdout.on('data', onData);
    render.stderr.on('data', onError);
    render.on('close', onClose); 

    // Track progress of rendering through stdout
    function onData(data) {

      // Is not a recordIndex (to skip Electron's logs or new lines)
      if (isNaN(parseInt(data.toString()))) {
        return;
      }

      progressBar.tick();
    }

    // Track rendering errors observed on stderr
    function onError(error) {

      // If error is Buffer, print it, otherwise reject
      if (!!error && error instanceof Buffer) {
        console.log(di.chalk.yellow(`[render] ${error.toString('utf8').trim()}`));
      } else {
        render.kill();
        reject(new Error("Unknown error [" + typeof error + "]: " + error));
      }
    } 

    // React when rendering process finishes
    function onClose(code) {
      if (code !== 0) {
        reject(new Error("Rendering exited with code " + code));
      } else {
        if (progressBar.complete) {
          console.log(di.chalk.green('[render] Process successfully completed in ' + (Date.now() - start) + 'ms.'));
        } else {
          console.log(di.chalk.yellow('[render] Process completion unverified'));
        }

        resolve();
      }
    };
  });
}

/**
 * Merge the rendered frames into an animated GIF image
 *
 * @param  {Array}   records         [{delay, content}, ...]
 * @param  {Object}  options         {quality, repeat, step, outputFile, format}
 * @param  {Object}  frameDimensions {width, height}
 * @return {Promise}
 */
function mergeFramesToGif(records, options, frameDimensions) {
  return new Promise(function (resolve, reject) {
    // The number of frames
    var framesCount = records.length;
    
    // Track execution time
    var start = Date.now();

    // Used for the step option
    var stepsCounter = 0;

    // Create a progress bar
    var progressBar = getProgressBar(
      "Merging",
      Math.ceil(framesCount / options.step)
    );

    // The gif image
    var gif = new di.GIFEncoder(frameDimensions.width, frameDimensions.height, {
      highWaterMark: 5 * 1024 * 1024,
    });

    // Pipe
    gif.pipe(di.fs.createWriteStream(options.outputFile));

    // Quality
    gif.setQuality(101 - options.quality);

    // Repeat
    gif.setRepeat(options.repeat);

    // Write the headers
    gif.writeHeader();

    di.async.eachOfSeries(
      records,
      function (frame, index, callback) {
        if (stepsCounter != 0) {
          stepsCounter = (stepsCounter + 1) % options.step;
          return callback();
        }

        stepsCounter = (stepsCounter + 1) % options.step;

        // The path of the rendered frame
        var framePath = di.path.join(renderDir, index + ".png");

        // Read and parse the rendered frame
        loadPNG(framePath)
          .then(function (png) {
            progressBar.tick();

            // Set the duration (the delay of the next frame)
            // The % is used to take the delay of the first frame
            // as the duration of the last frame
            gif.setDelay(records[(index + 1) % framesCount].delay);

            // Add frames
            gif.addFrame(png.data);

            // Next
            callback();
          })
          .catch(function (error) {
            callback(error);
          });
      },
      function (error) {
        if (error) {
          return reject(error);
        }

        // Write the footer
        gif.finish();

        // Finish
        console.log(di.chalk.green('[merge] Process successfully completed in ' + (Date.now() - start) + 'ms.'));
        resolve();
      }
    );
  });
}

/**
 * Delete the temporary rendered PNG images
 *
 * @return {Promise}
 */
function cleanup() {
  return new Promise(function (resolve, reject) {
    di.fs.emptyDir(di.path.join(ROOT_PATH, "render/frames"), function (error) {
      if (error) {
        return reject(error);
      }

      resolve();
    });
  });
}

/**
 * Executed after the command completes its task
 *
 * @param {String} outputFile the path of the rendered image
 * @param {String} format The output format ('gif' or 'mp4')
 */
function done(outputFile, format) {
  console.log("\n" + di.chalk.green("Successfully Rendered"));
  const fileType = format === 'mp4' ? 'MP4 video' : 'animated GIF image';
  console.log(`The ${fileType} is saved into the file:`);
  console.log(di.chalk.magenta(outputFile));
  
  // Check if the file exists and log its size
  try {
    const fs = require('fs');
    const stats = fs.statSync(outputFile);
    console.log(di.chalk.green(`File size: ${stats.size} bytes`));
    
    if (stats.size === 0) {
      console.error(di.chalk.red('Warning: Output file exists but is empty (0 bytes)'));
    }
  } catch (error) {
    console.error(di.chalk.red(`Error checking output file: ${error.message}`));
  }
  
  // Don't exit immediately for MP4 format to allow async operations to complete
  if (format !== 'mp4') {
    process.exit();
  }
}

/**
 * The command's main function
 *
 * @param {Object} argv
 */
function command(argv) {
  // Frames
  var records = argv.recordingFile.json.records;
  var config = argv.recordingFile.json.config;

  // Number of frames in the recording file
  var framesCount = records.length;

  // The path of the output file
  var outputFile = di.utility.resolveFilePath(
    "render" + Date.now(),
    argv.format
  );

  // For adjusting (calculating) the frames delays
  var adjustFramesDelaysOptions = {
    frameDelay: config.frameDelay,
    maxIdleTime: config.maxIdleTime,
  };

  // For rendering the frames into PNG images
  var renderingOptions = {
    step: argv.step,
  };

  // For merging the rendered frames into an animated GIF image
  var mergingOptions = {
    quality: config.quality,
    repeat: config.repeat,
    step: argv.step,
    outputFile: outputFile,
    format: argv.format,
  };

  // Overwrite the quality of the rendered image
  if (argv.quality) {
    mergingOptions.quality = argv.quality;
  }

  // Overwrite the outputFile of the rendered image
  if (argv.output) {
    // If output is provided, resolve it with the chosen format
    outputFile = di.utility.resolveFilePath(argv.output, argv.format);
    mergingOptions.outputFile = outputFile;
  } else {
    // If no output is provided, generate a default name with the chosen format
    outputFile = di.utility.resolveFilePath("render" + Date.now(), argv.format);
    mergingOptions.outputFile = outputFile;
  }


  // Tasks
  di.asyncPromises
    .waterfall([
      // Remove all previously rendered frames
      cleanup,

      // Write the recording data into render/data.json
      di._.partial(writeRecordingData, argv.recordingFile),

      // Render the frames into PNG images
      di._.partial(renderFrames, records, renderingOptions),

      // Adjust frames delays
      di._.partial(
        di.commands.play.adjustFramesDelays,
        records,
        adjustFramesDelaysOptions
      ),

      // Get the dimensions of the first rendered frame
      di._.partial(getFrameDimensions),

      // Merge the rendered frames
      function (frameDimensions, callback) {
        if (argv.format === 'mp4') {
          // We're using Node.js FFmpeg, so no need to check for system FFmpeg
          mergeFramesToMp4(records, mergingOptions, frameDimensions)
            .then(() => {
              if (typeof callback === 'function') {
                callback(null);
              }
            })
            .catch((error) => {
              if (typeof callback === 'function') {
                callback(error);
              } else {
                console.error(di.chalk.red('[merge-mp4] Error in waterfall: ' + error.message));
              }
            });
        } else {
          mergeFramesToGif(records, mergingOptions, frameDimensions)
            .then(() => {
              if (typeof callback === 'function') {
                callback(null);
              }
            })
            .catch((error) => {
              if (typeof callback === 'function') {
                callback(error);
              } else {
                console.error(di.chalk.red('[merge-gif] Error in waterfall: ' + error.message));
              }
            });
        }
      },

      // Delete the temporary rendered PNG images
      cleanup,
    ])
    .then(function () {
      done(outputFile, argv.format);
    })
    .catch(di.errorHandler);
}

/**
 * Merge the rendered frames into an MP4 video
 *
 * @param  {Array}   records         [{delay, content}, ...]
 * @param  {Object}  options         {step, outputFile}
 * @param  {Object}  frameDimensions {width, height}
 * @return {Promise}
 */
function mergeFramesToMp4(records, options, frameDimensions) {
  // Create an empty file at the output path to ensure it exists
  try {
    const fs = require('fs');
    fs.writeFileSync(options.outputFile, '');
    console.log(di.chalk.green(`[merge-mp4] Created empty file at ${options.outputFile}`));
  } catch (error) {
    console.error(di.chalk.red(`[merge-mp4] Error creating empty file: ${error.message}`));
  }
  
  return new Promise(function (resolve, reject) {
    const framesCount = records.length;
    const start = Date.now();
    let stepsCounter = 0;

    const progressBar = getProgressBar(
      "Merging to MP4",
      Math.ceil(framesCount / options.step)
    );

    console.log(di.chalk.green('[merge-mp4] Starting MP4 conversion with Node.js FFmpeg'));
    console.log("renderDir: ", renderDir);
    console.log("Frames count: ", framesCount);

    // Collect frame paths
    const framePaths = [];
    for (let i = 0; i < framesCount; i++) {
      if (stepsCounter !== 0) {
        stepsCounter = (stepsCounter + 1) % options.step;
        continue;
      }
      stepsCounter = (stepsCounter + 1) % options.step;
      const framePath = di.path.join(renderDir, i + ".png");
      framePaths.push(framePath);
    }

    // Calculate average frame rate based on frame delays
    let totalDelay = 0;
    for (let i = 0; i < records.length; i++) {
      totalDelay += records[i].delay;
    }
    const avgFrameRate = Math.round(1000 / (totalDelay / records.length));
    console.log(di.chalk.blue(`[merge-mp4] Average frame rate: ${avgFrameRate} fps`));

    // Convert frames to MP4 using Node.js FFmpeg
    convertFramesToMp4({
      framePaths: framePaths,
      outputPath: options.outputFile,
      dimensions: frameDimensions,
      frameRate: avgFrameRate,
      onProgress: (percent) => {
        progressBar.update(percent / 100 * progressBar.total);
      }
    })
    .then(() => {
      progressBar.update(progressBar.total); // Mark as complete
      console.log(di.chalk.green('[merge-mp4] Process successfully completed in ' + (Date.now() - start) + 'ms.'));
      resolve();
    })
    .catch((error) => {
      // Handle different error formats
      if (error && error.message) {
        console.error(di.chalk.red('[merge-mp4] Error: ' + error.message));
      } else if (error && error.msg) {
        console.error(di.chalk.red('[merge-mp4] Error: ' + error.msg));
      } else {
        console.error(di.chalk.red('[merge-mp4] Error: ' + JSON.stringify(error)));
      }
      reject(error);
    });
  });
}


////////////////////////////////////////////////////
// Command Definition //////////////////////////////
////////////////////////////////////////////////////

/**
 * Command's usage
 * @type {String}
 */
module.exports.command = "render <recordingFile>";

/**
 * Command's description
 * @type {String}
 */
module.exports.describe = "Render a recording file as an animated gif image or MP4 video";

/**
 * Command's handler function
 * @type {Function}
 */
module.exports.handler = command;

/**
 * Builder
 *
 * @param {Object} yargs
 */
module.exports.builder = function (yargs) {
  // Define the recordingFile argument
  yargs.positional("recordingFile", {
    describe: "The recording file",
    type: "string",
    coerce: di.utility.loadYAML,
  });

  // Define the output option
  yargs.option("o", {
    alias: "output",
    type: "string",
    describe: "A name for the output file (e.g., myrender.gif or myrender.mp4)",
    requiresArg: true,
  });

  // Define the format option
  yargs.option("f", {
    alias: "format",
    type: "string",
    describe: "The output format ('gif' or 'mp4')",
    default: "gif",
    choices: ["gif", "mp4"],
    requiresArg: true,
  });

  // Define the quality option
  yargs.option("q", {
    alias: "quality",
    type: "number",
    describe: "The quality of the rendered image (1 - 100)",
    requiresArg: true,
  });

  // Define the quality option
  yargs.option("s", {
    alias: "step",
    type: "number",
    describe: "To reduce the number of rendered frames (step > 1)",
    requiresArg: true,
    default: 1,
  });
};
