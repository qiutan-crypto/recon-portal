import * as XLSX from 'xlsx';

// Mock complex CSV data
const mockCsvData = `Transaction Date,Memo,Amount ($),Merchant
2023-01-01,Test Transaction,100.50,Store A
2023-01-02,Another Transaction,-50.25,Store B
2023-01-03,Invalid Amount,abc,Store C`;

// Create a workbook from the mock CSV data
const wb = XLSX.read(mockCsvData, { type: 'string' });
const wsname = wb.SheetNames[0];
const ws = wb.Sheets[wsname];
const jsonData = XLSX.utils.sheet_to_json(ws);

console.log("Raw JSON Data:", jsonData);

const surveyType = 'reconciliation';

if (surveyType === 'reconciliation') {
    const mapped = jsonData.map(row => {
        // Normalize keys to lowercase for easier matching, but keep original keys mapping
        const lowerKeys = Object.keys(row).reduce((acc, outputKey) => {
            acc[outputKey.toLowerCase().trim()] = row[outputKey];
            return acc;
        }, {});

        // Helper to find value by fuzzy key
        const getValue = (keywords) => {
            const key = Object.keys(lowerKeys).find(k => keywords.some(kw => k.includes(kw)));
            return key ? lowerKeys[key] : undefined;
        };

        // Find specific columns using fuzzy matching
        const date = getValue(['date', 'time']) || new Date().toISOString().split('T')[0];

        let description = getValue(['desc', 'memo', 'detail', 'narrative']) || 'Unknown';
        const payee = getValue(['payee', 'merchant']);

        // Merge Payee if it exists and adds value
        if (payee && String(payee).trim() !== '' && !String(description).toLowerCase().includes(String(payee).toLowerCase())) {
            description = `${description} - ${payee}`;
        }

        // Handle Amount
        let amountRaw = getValue(['amount', 'amt', 'value', 'price', 'cost']) || 0;
        if (typeof amountRaw === 'string') {
            amountRaw = parseFloat(amountRaw.replace(/[$,]/g, ''));
        }
        const amount = isNaN(amountRaw) ? 0 : amountRaw;

        return {
            date: date,
            description: description,
            amount: amount,
            type: amount < 0 ? 'Withdrawal' : 'Deposit'
        };
    }).filter(tx => tx.amount !== 0);

    console.log("Mapped Transactions:", mapped);
}
