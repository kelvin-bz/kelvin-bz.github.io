// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Create the main styles
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        #quote {
            display: flex;
            justify-content: center;
            align-items: center;
        }

        main {
            text-align: center;
        }

        .img-container {
            display: flex;
            justify-content: center;
        }
        
        .funny-quote {
            margin: 1rem auto;
            text-align: center;
            font-size: calc(14px + 1vmin);
            padding: 1rem;
            border-radius: 10px;
            background: #fff4bf;
            border: 2px dashed #FFA500;
            max-width: 80%;
            box-sizing: border-box;
        }
        
        .funny-image {
            margin-top: 1rem;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
    `;
    document.head.appendChild(styleElement);

    // Get the quote container
    const quoteContainer = document.getElementById('quote');

    // Create main element
    const mainElement = document.createElement('main');

    // Create quote div
    const quoteDiv = document.createElement('div');
    quoteDiv.className = 'funny-quote';
    quoteDiv.textContent = `"Believe you can and you're halfway there." 
       Theodore Roosevelt`;

    // Create image element
    const imgElement = document.createElement('img');
    imgElement.className = 'funny-image';
    imgElement.width = 200;
    imgElement.src = 'https://media.giphy.com/media/26n6WywJyh39n1pBu/giphy.gif';
    imgElement.alt = 'Lazy Llama';

    // add a div and add imgElement to it
    const imgDiv = document.createElement('div');
    imgDiv.className = 'img-container';
    imgDiv.appendChild(imgElement);

    // Append elements
    mainElement.appendChild(imgDiv);
    mainElement.appendChild(quoteDiv);
    quoteContainer.appendChild(mainElement);
});
