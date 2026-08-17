const { checkDependencies, printDoctorReport } = require('../utils/dependency-manager');

const report = checkDependencies();
printDoctorReport(report);
