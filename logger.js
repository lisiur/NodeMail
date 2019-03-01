const moment = require("moment")
const timeFormat = "YYYY-MM-DD HH:mm:ss"
module.exports = function logger(...log) {
    console.log(`[${moment().format(timeFormat)}] ${log}`)
}
