const ffmpeg = require('fluent-ffmpeg');
const dotenv = require('dotenv');
dotenv.config();

if (process.env.FFMPEG_PATH) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

ffmpeg.getAvailableFormats(function(err, formats) {
    if (err) {
        console.error('Error getting formats:', err);
    } else {
        console.log('dshow available?', 'dshow' in formats);
        // console.log('Formats:', formats);
    }
});
