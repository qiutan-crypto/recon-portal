const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/App.jsx');
let content = fs.readFileSync(filePath, 'utf8');

const startMarker = "if (isSpreadsheet) {";
const endMarker = "return; // Processing handled in onload";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
    console.error("Could not find start or end markers.");
    process.exit(1);
}

// Find the closing brace after the return statement
const blockEndIndex = content.indexOf('}', endIndex);

if (blockEndIndex === -1) {
    console.error("Could not find closing brace.");
    process.exit(1);
}

const before = content.substring(0, startIndex);
const after = content.substring(blockEndIndex + 1);

const newBlock = `      if (isSpreadsheet) {
        // Handle Spreadsheet Logic
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const bstr = evt.target.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];

            // Smart Header Detection
            const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
            let headerRowIndex = 0;
            const targetKeywords = ['date', 'amount', 'balance', 'description', 'reference', 'details', 'payee'];
            
            for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
              const row = rawRows[i];
              if (!row || row.length === 0) continue;
              const rowStr = row.join(' ').toLowerCase();
              const matchCount = targetKeywords.filter(kw => rowStr.includes(kw)).length;
              if (matchCount >= 2) {
                headerRowIndex = i;
                break;
              }
            }
            console.log(\`Detected header at row index: \${headerRowIndex}\`);

            const jsonData = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex });

            if (jsonData.length > 0) {
              const headers = Object.keys(jsonData[0]);
              alert(\`Read \${jsonData.length} rows.\\nDetected Headers: \${headers.join(', ')}\`);
            } else {
              alert("Could not read any data rows.");
            }

            if (surveyType === 'reconciliation') {
              const mapped = jsonData.map(row => {
                const lowerKeys = Object.keys(row).reduce((acc, outputKey) => {
                  acc[outputKey.toLowerCase().trim()] = row[outputKey];
                  return acc;
                }, {});

                const getValue = (keywords) => {
                  const key = Object.keys(lowerKeys).find(k => keywords.some(kw => k.includes(kw)));
                  return key ? lowerKeys[key] : undefined;
                };

                const dateRaw = getValue(['date', 'time']);
                const date = dateRaw || new Date().toISOString().split('T')[0];
                
                let description = getValue(['desc', 'memo', 'detail', 'narrative']) || 'Unknown';
                const payee = getValue(['payee', 'merchant']);
                
                if (payee && String(payee).trim() !== '' && !String(description).toLowerCase().includes(String(payee).toLowerCase())) {
                  description = \`\${description} - \${payee}\`;
                }

                let amount = 0;
                let amountRaw = getValue(['amount', 'amt', 'value', 'price', 'cost']);
                
                if (amountRaw !== undefined) {
                   if (typeof amountRaw === 'string') {
                      amountRaw = parseFloat(amountRaw.replace(/[$,]/g, ''));
                   }
                   amount = isNaN(amountRaw) ? 0 : amountRaw;
                } else {
                   const debitRaw = getValue(['payment', 'debit', 'withdrawal', 'decrea', 'out']);
                   const creditRaw = getValue(['deposit', 'credit', 'increa', 'in']); 
                   
                   const parseVal = (v) => {
                      if (!v) return 0;
                      if (typeof v === 'number') return v;
                      return parseFloat(v.replace(/[$,]/g, '')) || 0;
                   };
                   
                   const debit = parseVal(debitRaw);
                   const credit = parseVal(creditRaw);
                   if (debit !== 0 || credit !== 0) {
                      amount = credit - debit;
                   }
                }

                return {
                  date: date,
                  dateCallback: !dateRaw,
                  description: description,
                  amount: amount,
                  type: amount < 0 ? 'Withdrawal' : 'Deposit',
                  original: row
                };
              }).filter(tx => {
                if (tx.amount === 0) return false;
                
                const allValues = Object.values(tx.original).join(' ').toLowerCase();
                if (allValues.includes('total') || allValues.includes('balance')) return false;

                if (tx.description === 'Unknown' && tx.dateCallback) return false;
                
                const desc = String(tx.description).toLowerCase();
                if (desc.startsWith('total')) return false;

                if (!tx.date || tx.date.length > 50 || tx.date.toLowerCase().includes('date')) return false;

                return true;
              });

              alert(\`Successfully mapped \${mapped.length} transactions.\`);
              setExtractedData({ transactions: mapped });
              setView('preview-data');
            } else {
              const headers = Object.keys(jsonData[0] || {});
              const fields = headers.map(h => ({
                label: h,
                type: 'text'
              }));
              setExtractedData({ fields });
              setView('preview-data');
            }
          } catch (err) {
            console.error(err);
            alert("Error parsing spreadsheet: " + err.message);
          } finally {
            setIsProcessing(false);
          }
        };
        reader.readAsBinaryString(file);
        return; 
      }`;

const newContent = before + newBlock + after;
fs.writeFileSync(filePath, newContent, 'utf8');
console.log("Successfully patched App.jsx");
