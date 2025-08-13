#!/usr/bin/env node

/**
 * TodoDOS - Eine Terminal-basierte Todo-App mit Google Sheets Integration
 */

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import readline from 'readline';
import boxen from 'boxen';
import chalk from 'chalk';
import figlet from 'figlet';
import cliCursor from 'cli-cursor';

// Konfiguration für Google Sheets API
const SPREADSHEET_ID = 'xxxxx';
const CREDENTIALS_PATH = './credentials.json';

// Initialisierung
let doc;
let tasks = [];
let selectedIndex = 0;
let view = 'main';
let searchTerm = '';
let rl;

// Google Sheets Verbindung herstellen
async function connectToSheet() {
  try {
    // Prüfe ob credentials.json existiert
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      console.error(chalk.red('✗ credentials.json nicht gefunden!'));
      console.error(chalk.yellow('   Bitte erstelle eine Service Account credentials.json Datei'));
      return false;
    }

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    
    // Prüfe ob alle notwendigen Felder vorhanden sind
    if (!credentials.client_email || !credentials.private_key) {
      console.error(chalk.red('✗ Unvollständige credentials.json'));
      console.error(chalk.yellow('   client_email oder private_key fehlt'));
      return false;
    }

    const serviceAccountAuth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    
    console.log(chalk.green('✓ Verbindung zu Google Sheets hergestellt'));
    console.log(chalk.dim(`   Sheet: ${doc.title}`));
    console.log(chalk.dim(`   Service Account: ${credentials.client_email}`));
    return true;
    
  } catch (error) {
    console.error(chalk.red('✗ Fehler bei der Verbindung zu Google Sheets:'));
    
    if (error.message.includes('404')) {
      console.error(chalk.yellow('   → Sheet nicht gefunden. Prüfe die SPREADSHEET_ID'));
    } else if (error.message.includes('403')) {
      console.error(chalk.yellow('   → Keine Berechtigung. Hast du das Sheet mit dem Service Account geteilt?'));
      console.error(chalk.dim('     Service Account Email sollte Zugriff haben'));
    } else if (error.message.includes('400')) {
      console.error(chalk.yellow('   → Ungültige Anfrage. Prüfe deine credentials.json'));
    } else {
      console.error(chalk.dim(`   Fehler: ${error.message}`));
    }
    
    return false;
  }
}

// Aufgaben laden
async function loadTasks() {
  try {
    if (!doc) {
      console.log(chalk.yellow('⚠ Keine Verbindung zu Google Sheets - verwende lokale Daten'));
      return false;
    }

    const sheet = doc.sheetsByIndex[0];
    
    // Prüfe ob Sheet-Header existieren, falls nicht erstelle sie
    await sheet.loadCells('A1:E1');
    const headerRow = ['title', 'status', 'priority', 'dueDate', 'tags'];
    
    if (!sheet.getCellByA1('A1').value) {
      console.log(chalk.blue('📋 Erstelle Sheet-Header...'));
      await sheet.setHeaderRow(headerRow);
    }
    
    const rows = await sheet.getRows();
    tasks = rows.map((row, index) => ({
      id: index + 1,
      title: row.get('title') || 'Keine Beschreibung',
      status: row.get('status') || 'offen',
      priority: row.get('priority') || 'normal',
      dueDate: row.get('dueDate') || '',
      tags: (row.get('tags') || '').split(',').filter(tag => tag.trim().length > 0),
    }));
    
    console.log(chalk.green(`✓ ${tasks.length} Aufgaben geladen`));
    return true;
    
  } catch (error) {
    console.error(chalk.red('✗ Fehler beim Laden der Aufgaben:'));
    console.error(chalk.dim(`   ${error.message}`));
    
    // Fallback: leere Tasks-Liste
    tasks = [];
    return false;
  }
}

// Aufgaben speichern
async function saveTasks() {
  try {
    if (!doc) {
      console.log(chalk.yellow('⚠ Keine Verbindung zu Google Sheets - kann nicht speichern'));
      return false;
    }

    const sheet = doc.sheetsByIndex[0];
    
    console.log(chalk.blue('💾 Speichere Aufgaben...'));
    
    // Stelle sicher, dass Header existieren
    await sheet.loadCells('A1:E1');
    if (!sheet.getCellByA1('A1').value) {
      await sheet.setHeaderRow(['title', 'status', 'priority', 'dueDate', 'tags']);
    }
    
    // Lade alle bestehenden Zeilen
    const rows = await sheet.getRows();
    
    // Lösche alle bestehenden Datenzeilen (aber nicht den Header)
    for (let i = rows.length - 1; i >= 0; i--) {
      await rows[i].delete();
    }
    
    // Füge neue Zeilen hinzu
    const newRows = tasks.map(task => ({
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      tags: task.tags.join(','),
    }));
    
    if (newRows.length > 0) {
      await sheet.addRows(newRows);
    }
    
    console.log(chalk.green(`✓ ${tasks.length} Aufgaben erfolgreich gespeichert`));
    return true;
    
  } catch (error) {
    console.error(chalk.red('✗ Fehler beim Speichern der Aufgaben:'));
    console.error(chalk.dim(`   ${error.message}`));
    
    if (error.message.includes('403')) {
      console.error(chalk.yellow('   → Keine Schreibberechtigung. Prüfe Sheet-Freigabe.'));
    }
    
    return false;
  }
}

// Aufgabe hinzufügen
function addTask(title, priority = 'normal', dueDate = '', tags = []) {
  tasks.push({
    id: tasks.length + 1,
    title,
    status: 'offen',
    priority,
    dueDate,
    tags,
  });
}

// Aufgabe löschen
function deleteTask(index) {
  tasks.splice(index, 1);
  // IDs neu zuweisen
  tasks.forEach((task, i) => {
    task.id = i + 1;
  });
}

// Schnelle Aufgabe hinzufügen (nur Titel)
async function handleQuickAdd() {
  return new Promise((resolve) => {
    console.log(chalk.blue('\n⚡ Schnell-Aufgabe hinzufügen'));
    rl.question('Titel: ', (title) => {
      if (title.trim()) {
        addTask(title.trim());
        console.log(chalk.green(`✓ Aufgabe "${title.trim()}" schnell hinzugefügt`));
      } else {
        console.log(chalk.yellow('Abgebrochen - kein Titel eingegeben'));
      }
      resolve();
    });
  });
}
function editTask(index, updates) {
  tasks[index] = { ...tasks[index], ...updates };
}

// Aufgabe als erledigt markieren
function completeTask(index) {
  tasks[index].status = tasks[index].status === 'erledigt' ? 'offen' : 'erledigt';
}

// Hilfefunktion anzeigen
function showHelp() {
  console.clear();
  const helpText = `
${chalk.bold('TodoDOS - Kommandos:')}

${chalk.yellow('Navigation:')}
  up/k ............ Nach oben bewegen
  down/j .......... Nach unten bewegen
  home ............ Zum Anfang springen
  end ............. Zum Ende springen

${chalk.yellow('Aktionen:')}
  add ............. Aufgabe hinzufügen
  delete .......... Aufgabe löschen
  edit ............ Aufgabe bearbeiten
  toggle .......... Aufgabe als erledigt markieren
  search .......... Suchen
  save ............ Speichern
  reload .......... Neu laden
  
${chalk.yellow('Ansicht:')}
  help ............ Hilfe anzeigen
  details ......... Details anzeigen
  quit ............ Beenden
  
${chalk.dim('Tipp: Verwende Kurzbefehle wie "a" für add, "d" für delete, etc.')}
`;

  console.log(boxen(helpText, {
    padding: 1,
    margin: 1,
    borderStyle: 'double',
    borderColor: 'blue',
  }));
}

// Hauptansicht rendern
function renderMainView() {
  console.clear();
  
  // Header
  console.log(
    chalk.blue(
      figlet.textSync('TodoDOS', {
        font: 'Small',
        horizontalLayout: 'default',
        verticalLayout: 'default',
      })
    )
  );
  
  // Status-Zeile
  console.log(
    boxen(
      `Aufgaben: ${tasks.length} | Offen: ${tasks.filter(t => t.status === 'offen').length} | Erledigt: ${tasks.filter(t => t.status === 'erledigt').length}`,
      { padding: 0, borderStyle: 'single', borderColor: 'gray' }
    )
  );
  
  // Steuerungshinweise
  console.log(chalk.dim(' Befehle: add, delete, edit, toggle, search, help, quit\n'));
  
  // Suchleiste, falls aktiv
  if (searchTerm.length > 0) {
    console.log(chalk.yellow(` 🔍 Suche: "${searchTerm}" (Zum Löschen: "search" eingeben)`));
  }
  
  // Aufgabenliste
  if (tasks.length === 0) {
    console.log(chalk.dim('\n  Keine Aufgaben vorhanden. Gib "add" ein, um eine neue Aufgabe hinzuzufügen.\n'));
  } else {
    const filteredTasks = searchTerm.length > 0
      ? tasks.filter(task => task.title.toLowerCase().includes(searchTerm.toLowerCase()))
      : tasks;
    
    if (filteredTasks.length === 0) {
      console.log(chalk.dim('\n  Keine Treffer für die Suche gefunden.\n'));
    } else {
      console.log(
        chalk.dim('  Nr │ Status   │ Prio    │ Fälligkeit   │ Titel')
      );
      console.log(
        chalk.dim('  ───┼──────────┼─────────┼──────────────┼────────────────────────────')
      );
      
      filteredTasks.forEach((task, index) => {
        const isSelected = index === selectedIndex;
        const statusColor = task.status === 'erledigt' ? chalk.green : chalk.yellow;
        const priorityColor = 
          task.priority === 'hoch' ? chalk.red :
          task.priority === 'niedrig' ? chalk.blue :
          chalk.white;
        
        const line = ` ${(index + 1).toString().padStart(3)} │ ${statusColor(task.status.padEnd(8))} │ ${priorityColor(task.priority.padEnd(7))} │ ${(task.dueDate || '').padEnd(12)} │ ${task.title.substring(0, 40)}${task.title.length > 40 ? '...' : ''}`;
        
        if (isSelected) {
          console.log(chalk.bgBlue(line));
        } else {
          console.log(line);
        }
      });
      
      // Aktuelle Auswahl anzeigen
      if (filteredTasks.length > 0) {
        console.log(chalk.dim(`\n  → Ausgewählt: ${filteredTasks[selectedIndex]?.title || 'Keine'}`));
      }
    }
  }
}

// Details-Ansicht rendern
function renderDetailsView() {
  if (tasks.length === 0 || selectedIndex >= tasks.length) {
    console.log(chalk.red('Keine Aufgabe ausgewählt.'));
    return;
  }
  
  const task = tasks[selectedIndex];
  
  console.clear();
  console.log(chalk.blue(figlet.textSync('Details', { font: 'Small' })));
  
  const detailsBox = boxen(
    `${chalk.bold('ID:')} ${task.id}
${chalk.bold('Titel:')} ${task.title}
${chalk.bold('Status:')} ${task.status === 'erledigt' ? chalk.green(task.status) : chalk.yellow(task.status)}
${chalk.bold('Priorität:')} ${
  task.priority === 'hoch' ? chalk.red(task.priority) :
  task.priority === 'niedrig' ? chalk.blue(task.priority) :
  chalk.white(task.priority)
}
${chalk.bold('Fälligkeit:')} ${task.dueDate || 'Nicht gesetzt'}
${chalk.bold('Tags:')} ${task.tags.length > 0 ? task.tags.join(', ') : 'Keine'}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'blue',
    }
  );
  
  console.log(detailsBox);
}

// Eingabeaufforderung anzeigen
function showPrompt() {
  const currentTask = tasks[selectedIndex];
  const taskInfo = currentTask ? `[${selectedIndex + 1}/${tasks.length}] ${currentTask.title.substring(0, 20)}${currentTask.title.length > 20 ? '...' : ''}` : '';
  
  console.log(chalk.dim(`\n${taskInfo}`));
  rl.question(chalk.cyan('TodoDOS> '), handleCommand);
}

// Kommando verarbeiten
async function handleCommand(input) {
  const command = input.trim().toLowerCase();
  const args = input.trim().split(' ');
  
  try {
    switch (command) {
      case 'quit':
      case 'q':
      case 'exit':
        console.log(chalk.blue('Auf Wiedersehen! 👋'));
        process.exit(0);
        break;
        
      case 'help':
      case 'h':
        showHelp();
        break;
        
      case 'add':
      case 'a':
        await handleAddTask();
        break;
        
      case 'quick':
      case 'qa':
        await handleQuickAdd();
        break;
        
      case 'delete':
      case 'd':
        handleDeleteTask();
        break;
        
      case 'edit':
      case 'e':
        await handleEditTask();
        break;
        
      case 'toggle':
      case 't':
      case 'space':
        handleToggleTask();
        break;
        
      case 'save':
      case 's':
        await saveTasks();
        break;
        
      case 'reload':
      case 'r':
        await loadTasks();
        console.log(chalk.green('✓ Aufgaben neu geladen'));
        break;
        
      case 'search':
      case '/':
        await handleSearch();
        break;
        
      case 'details':
      case 'show':
        renderDetailsView();
        break;
        
      case 'up':
      case 'k':
        selectedIndex = Math.max(0, selectedIndex - 1);
        break;
        
      case 'down':
      case 'j':
        selectedIndex = Math.min(tasks.length - 1, selectedIndex + 1);
        break;
        
      case 'home':
        selectedIndex = 0;
        break;
        
      case 'end':
        selectedIndex = Math.max(0, tasks.length - 1);
        break;
        
      case 'clear':
        searchTerm = '';
        console.log(chalk.green('✓ Suche gelöscht'));
        break;
        
      default:
        if (input.trim() === '') {
          // Leere Eingabe - nichts tun
        } else if (!isNaN(parseInt(command))) {
          // Nummer eingegeben - zur Aufgabe springen
          const num = parseInt(command) - 1;
          if (num >= 0 && num < tasks.length) {
            selectedIndex = num;
            console.log(chalk.green(`✓ Zu Aufgabe ${num + 1} gesprungen`));
          } else {
            console.log(chalk.red('Ungültige Aufgabennummer'));
          }
        } else {
          console.log(chalk.red(`Unbekanntes Kommando: "${input}". Gib "help" für Hilfe ein.`));
        }
    }
    
    renderMainView();
    showPrompt();
    
  } catch (error) {
    console.error(chalk.red('Fehler:'), error.message);
    showPrompt();
  }
}

// Aufgabe hinzufügen
async function handleAddTask() {
  return new Promise(async (resolve) => {
    console.log(chalk.blue('\n📝 Neue Aufgabe hinzufügen'));
    
    // Titel abfragen
    rl.question('Titel: ', async (title) => {
      if (!title.trim()) {
        console.log(chalk.yellow('Abgebrochen - kein Titel eingegeben'));
        resolve();
        return;
      }

      // Priorität abfragen
      rl.question('Priorität [normal/hoch/niedrig] (Enter für normal): ', async (priority) => {
        const validPriorities = ['normal', 'hoch', 'niedrig'];
        const taskPriority = priority.trim().toLowerCase() || 'normal';
        
        if (!validPriorities.includes(taskPriority)) {
          console.log(chalk.yellow(`Ungültige Priorität "${priority}" - verwende "normal"`));
        }

        // Fälligkeit abfragen
        rl.question('Fälligkeit [YYYY-MM-DD oder DD.MM.YYYY] (Enter für keine): ', async (dueDate) => {
          let formattedDate = '';
          
          if (dueDate.trim()) {
            // Formatiere verschiedene Datumsformate
            const dateStr = dueDate.trim();
            let parsedDate = null;
            
            // Versuche verschiedene Formate zu parsen
            if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
              // YYYY-MM-DD Format
              parsedDate = new Date(dateStr);
            } else if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
              // DD.MM.YYYY Format
              const [day, month, year] = dateStr.split('.');
              parsedDate = new Date(year, month - 1, day);
            } else if (dateStr.match(/^\d{1,2}\.\d{1,2}$/)) {
              // DD.MM Format (aktuelles Jahr)
              const [day, month] = dateStr.split('.');
              const currentYear = new Date().getFullYear();
              parsedDate = new Date(currentYear, month - 1, day);
            }
            
            if (parsedDate && !isNaN(parsedDate.getTime())) {
              formattedDate = parsedDate.toISOString().split('T')[0]; // YYYY-MM-DD
            } else {
              console.log(chalk.yellow(`Ungültiges Datum "${dateStr}" - wird ignoriert`));
            }
          }

          // Tags abfragen
          rl.question('Tags [komma,getrennt] (Enter für keine): ', (tags) => {
            const taskTags = tags.trim() 
              ? tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
              : [];

            // Aufgabe erstellen
            addTask(title.trim(), validPriorities.includes(taskPriority) ? taskPriority : 'normal', formattedDate, taskTags);
            
            console.log(chalk.green(`✓ Aufgabe "${title.trim()}" hinzugefügt`));
            
            if (taskPriority !== 'normal') {
              console.log(chalk.dim(`   Priorität: ${taskPriority}`));
            }
            if (formattedDate) {
              console.log(chalk.dim(`   Fälligkeit: ${formattedDate}`));
            }
            if (taskTags.length > 0) {
              console.log(chalk.dim(`   Tags: ${taskTags.join(', ')}`));
            }
            
            resolve();
          });
        });
      });
    });
  });
}

// Aufgabe löschen
function handleDeleteTask() {
  if (tasks.length === 0) {
    console.log(chalk.yellow('Keine Aufgaben zum Löschen vorhanden'));
    return;
  }
  
  if (selectedIndex >= 0 && selectedIndex < tasks.length) {
    const task = tasks[selectedIndex];
    deleteTask(selectedIndex);
    selectedIndex = Math.min(selectedIndex, tasks.length - 1);
    console.log(chalk.green(`✓ Aufgabe "${task.title}" gelöscht`));
  }
}

// Aufgabe bearbeiten
async function handleEditTask() {
  if (tasks.length === 0 || selectedIndex >= tasks.length) {
    console.log(chalk.yellow('Keine Aufgabe zum Bearbeiten ausgewählt'));
    return;
  }
  
  const task = tasks[selectedIndex];
  return new Promise(async (resolve) => {
    console.log(chalk.blue(`\n✏️  Aufgabe bearbeiten: "${task.title}"`));
    console.log(chalk.dim('(Enter lässt Wert unverändert)\n'));
    
    // Titel bearbeiten
    rl.question(`Titel [${task.title}]: `, async (newTitle) => {
      if (newTitle.trim()) {
        task.title = newTitle.trim();
      }

      // Priorität bearbeiten
      rl.question(`Priorität [${task.priority}] (normal/hoch/niedrig): `, async (newPriority) => {
        const validPriorities = ['normal', 'hoch', 'niedrig'];
        if (newPriority.trim() && validPriorities.includes(newPriority.trim().toLowerCase())) {
          task.priority = newPriority.trim().toLowerCase();
        }

        // Fälligkeit bearbeiten
        const currentDue = task.dueDate || 'keine';
        rl.question(`Fälligkeit [${currentDue}] (YYYY-MM-DD, DD.MM.YYYY oder 'keine'): `, async (newDueDate) => {
          if (newDueDate.trim()) {
            if (newDueDate.trim().toLowerCase() === 'keine') {
              task.dueDate = '';
            } else {
              const dateStr = newDueDate.trim();
              let parsedDate = null;
              
              if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                parsedDate = new Date(dateStr);
              } else if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                const [day, month, year] = dateStr.split('.');
                parsedDate = new Date(year, month - 1, day);
              } else if (dateStr.match(/^\d{1,2}\.\d{1,2}$/)) {
                const [day, month] = dateStr.split('.');
                const currentYear = new Date().getFullYear();
                parsedDate = new Date(currentYear, month - 1, day);
              }
              
              if (parsedDate && !isNaN(parsedDate.getTime())) {
                task.dueDate = parsedDate.toISOString().split('T')[0];
              } else {
                console.log(chalk.yellow(`Ungültiges Datum "${dateStr}" - nicht geändert`));
              }
            }
          }

          // Tags bearbeiten
          const currentTags = task.tags.length > 0 ? task.tags.join(', ') : 'keine';
          rl.question(`Tags [${currentTags}] (komma,getrennt oder 'keine'): `, (newTags) => {
            if (newTags.trim()) {
              if (newTags.trim().toLowerCase() === 'keine') {
                task.tags = [];
              } else {
                task.tags = newTags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
              }
            }

            console.log(chalk.green(`✓ Aufgabe "${task.title}" aktualisiert`));
            resolve();
          });
        });
      });
    });
  });
}

// Aufgabe als erledigt markieren
function handleToggleTask() {
  if (tasks.length === 0 || selectedIndex >= tasks.length) {
    console.log(chalk.yellow('Keine Aufgabe zum Umschalten ausgewählt'));
    return;
  }
  
  const task = tasks[selectedIndex];
  completeTask(selectedIndex);
  const newStatus = task.status === 'erledigt' ? 'offen' : 'erledigt';
  console.log(chalk.green(`✓ Aufgabe "${task.title}" als ${task.status} markiert`));
}

// Suche durchführen
async function handleSearch() {
  return new Promise((resolve) => {
    console.log(chalk.blue('\n🔍 Suche'));
    console.log(chalk.dim('Aktuelle Suche: ' + (searchTerm || 'keine')));
    rl.question('Suchbegriff (Enter für löschen): ', (term) => {
      searchTerm = term.trim();
      if (searchTerm) {
        console.log(chalk.green(`✓ Suche nach "${searchTerm}"`));
      } else {
        console.log(chalk.green('✓ Suche gelöscht'));
      }
      resolve();
    });
  });
}

// Readline Interface initialisieren
function initializeReadline() {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });
  
  // Graceful shutdown
  rl.on('SIGINT', () => {
    console.log('\n\nAuf Wiedersehen! 👋');
    process.exit(0);
  });
}

// Hauptfunktion
async function main() {
  console.clear();
  console.log(chalk.blue(figlet.textSync('TodoDOS', { font: 'Slant' })));
  console.log(chalk.dim('Verbinde mit Google Sheets...'));
  
  initializeReadline();
  
  const connected = await connectToSheet();
  if (!connected) {
    console.log(chalk.yellow('\nDu kannst die App trotzdem nutzen, aber Änderungen werden nicht in Google Sheets gespeichert.'));
  } else {
    console.log(chalk.blue('📥 Lade Aufgaben aus Google Sheets...'));
    const loaded = await loadTasks();
    if (loaded && tasks.length > 0) {
      console.log(chalk.green(`✓ ${tasks.length} Aufgaben aus Google Sheets geladen`));
    } else if (loaded && tasks.length === 0) {
      console.log(chalk.dim('   Sheet ist leer - bereit für neue Aufgaben'));
    }
  }
  
  console.log(chalk.green('\n✓ TodoDOS bereit!'));
  console.log(chalk.dim('Gib "help" für Hilfe ein.\n'));
  
  renderMainView();
  showPrompt();
}

// Starten der App
main().catch(error => {
  console.error('Fehler beim Starten der App:', error);
  process.exit(1);
});